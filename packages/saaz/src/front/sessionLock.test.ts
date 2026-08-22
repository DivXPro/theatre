/* eslint-disable no-restricted-syntax */
import type {$IntentionalAny, Schema, SessionState} from '../types'
import {SaazFront} from './SaazFront'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'
import SaazBack from '../back/SaazBack'
import {BackMemoryAdapter} from '../back/BackMemoryAdapter'

jest.setTimeout(5000)

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

const LOCK_PREFIX = 'theatrejs-saaz-closed-session-lock/'

/**
 * Minimal navigator.locks stub that records acquisitions and releases. Each
 * `request` acquires immediately and the returned promise settles when the
 * callback (which holds the lock) finishes.
 */
class MockNavigatorLocks {
  public acquired: string[] = []
  public released: string[] = []

  request(
    name: string,
    _opts: {
      mode: 'exclusive' | 'shared'
      ifAvailable: boolean
      steal: boolean
    },
    callback: (lock: {name: string; mode: string} | null) => Promise<void>,
  ): Promise<unknown> {
    this.acquired.push(name)
    return callback({name, mode: _opts.mode}).then(() => {
      this.released.push(name)
    })
  }
}

const installMockLocks = (): MockNavigatorLocks => {
  const locks = new MockNavigatorLocks()
  Object.defineProperty(navigator, 'locks', {
    value: locks,
    configurable: true,
    writable: true,
  })
  return locks
}

const restoreLocks = () => {
  delete (navigator as $IntentionalAny).locks
}

const seedClosedSession = async (peerId: string) => {
  const adapter = new FrontMemoryAdapter()
  const state: SessionState<OpShape> = {
    lastSyncTime: null,
    backendClock: 5,
    lastIncorporatedPeerClock: 4,
    snapshot: {op: {opCount: 1, $schemaVersion: 1}, cell: {}},
    peerId,
  }
  await adapter.transaction(async (t) => {
    await t.set('sessionState', state, peerId)
  })
  return adapter
}

test('teardown releases the session locks acquired for crashed sessions', async () => {
  const locks = installMockLocks()
  try {
    const frontAdapter = await seedClosedSession('crashedPeer')
    const back = new SaazBack({
      dbName: 'd',
      storageAdapter: new BackMemoryAdapter(),
      schema,
    })
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: frontAdapter,
      backend: back,
    })
    await front.ready

    // init acquired a lock for the crashed session and is still holding it
    expect(locks.acquired).toEqual([LOCK_PREFIX + 'crashedPeer'])
    expect(locks.released).toHaveLength(0)

    front.teardown()

    // flush microtasks so the lock callbacks observe the unlock
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(locks.released).toEqual(locks.acquired)
  } finally {
    restoreLocks()
  }
})

test('teardown is a no-op when no locks were acquired', async () => {
  const locks = installMockLocks()
  try {
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(),
      backend: new SaazBack({
        dbName: 'd',
        storageAdapter: new BackMemoryAdapter(),
        schema,
      }),
    })
    await front.ready

    expect(locks.acquired).toHaveLength(0)
    front.teardown()
    expect(locks.released).toHaveLength(0)
  } finally {
    restoreLocks()
  }
})
