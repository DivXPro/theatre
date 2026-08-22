/* eslint-disable no-restricted-syntax */
import type {
  $IntentionalAny,
  FrontStorageAdapterTransaction,
  SaazBackInterface,
  Schema,
} from '../types'
import {SaazFront} from './SaazFront'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

const SNAPSHOT = {op: {$schemaVersion: 1, opCount: 1}, cell: {}}

type FakeBackend = Record<string, unknown>

const createFakeBackend = (): FakeBackend => {
  const fake: FakeBackend = {}
  Object.assign(fake, {
    async subscribe(_opts: unknown, _onUpdate: unknown): Promise<() => void> {
      return () => undefined
    },
    async getUpdatesSinceClock(): Promise<unknown> {
      return {
        hasUpdates: false,
        clock: null,
        lastIncorporatedPeerClock: null,
        peerId: 'p',
      }
    },
    async applyUpdates(): Promise<unknown> {
      return {ok: true}
    },
    async updatePresence(): Promise<unknown> {
      return {ok: true}
    },
    async closePeer(): Promise<unknown> {
      return {ok: true}
    },
    async getLastIncorporatedPeerClock(): Promise<unknown> {
      return {lastIncorporatedPeerClock: null, peerId: 'p'}
    },
  })
  return fake
}

/**
 * A memory adapter whose `transaction` can be armed to suspend on a gate and
 * then throw. Used to simulate a storage reflection that is still in-flight
 * when teardown runs and fails only afterwards.
 */
class GatedThrowingAdapter extends FrontMemoryAdapter {
  private _armed = false
  private _gateResolve: (() => void) | null = null
  private _gate: Promise<void> | null = null

  armWithGate(): void {
    this._armed = true
    this._gate = new Promise((resolve) => {
      this._gateResolve = resolve
    })
  }

  releaseGate(): void {
    this._gateResolve?.()
  }

  override async transaction<T>(
    fn: (opts: FrontStorageAdapterTransaction) => Promise<T>,
  ): Promise<T> {
    if (this._armed) {
      const gate = this._gate
      if (gate) await gate
      throw new Error('storage adapter closed')
    }
    return super.transaction(fn)
  }
}

test('an in-flight storage reflection failing after teardown is silenced', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  const adapter = new GatedThrowingAdapter()
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: adapter,
    backend: createFakeBackend() as unknown as SaazBackInterface,
    peerId: 'p',
  })
  await front.ready
  // let _init finish pushing the teardown callbacks and the initial backend
  // sync settle before we arm the adapter
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  adapter.armWithGate()

  // changing sessionState fires _reflectBackendStateToStorage; its storage
  // transaction suspends on the gate → the reflection is in-flight
  front._setSessionState({
    backendClock: 5,
    lastIncorporatedPeerClock: 3,
    lastSyncTime: 999,
    snapshot: SNAPSHOT,
    peerId: 'p',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  front.teardown()

  // the in-flight transaction now fails — after teardown
  adapter.releaseGate()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(errorSpy).not.toHaveBeenCalled()
  errorSpy.mockRestore()
})

test('an updatePresence rejection is handled, not an unhandled rejection', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)

  try {
    const backend = createFakeBackend()
    Object.assign(backend, {
      async updatePresence(): Promise<unknown> {
        throw new Error('presence failure')
      },
    })

    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(),
      backend: backend as unknown as SaazBackInterface,
      peerId: 'p',
    })
    await front.ready
    await new Promise((resolve) => setTimeout(resolve, 0))

    // registering a temp transaction fires _reflectPresenceToBackend, which
    // calls the (rejecting) backend.updatePresence
    front.tempTx()

    // flush well past the 30ms presence debounce
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(unhandled).toHaveLength(0)
    // the error is still surfaced via console.error (it happened before
    // teardown), just no longer as an unhandled rejection. It fires for both
    // the eager init presence sync and the tempTx-triggered one.
    expect(errorSpy).toHaveBeenCalled()

    front.teardown()
  } finally {
    process.off('unhandledRejection', onUnhandled)
    errorSpy.mockRestore()
  }
})
