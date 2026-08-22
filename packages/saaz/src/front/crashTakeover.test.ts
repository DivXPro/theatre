/* eslint-disable no-restricted-syntax */
import type {
  $IntentionalAny,
  SaazBackInterface,
  Schema,
  SessionState,
  Transaction,
} from '../types'
import {SaazFront} from './SaazFront'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'

type OpShape = {$schemaVersion: number; opCount: number}
type Editors = {setCount(state: OpShape, g: {}, opts: {to: number}): void}

const editors: Editors = {
  setCount(state, _g, opts) {
    state.opCount = opts.to
  },
}

const schema: Schema<OpShape, Editors, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors,
  generators: {},
  cellShape: {},
}

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
 * Seeds a crashed session (peerId `crashedPeer`) that wrote a session state to
 * storage but crashed before pushing its optimistic update to the backend.
 */
const seedCrashedSession = async (
  adapter: FrontMemoryAdapter,
): Promise<void> => {
  const state: SessionState<OpShape> = {
    lastSyncTime: null,
    backendClock: 0,
    lastIncorporatedPeerClock: 0,
    snapshot: {op: {$schemaVersion: 1, opCount: 1}, cell: {}},
    peerId: 'crashedPeer',
  }
  const unsentUpdate: Transaction = {
    invokations: [['setCount', {to: 99}]],
    generatorRecordings: {},
    peerId: 'crashedPeer',
    peerClock: 1,
    draftOps: [],
  }
  await adapter.transaction(async (t) => {
    await t.set('sessionState', state, 'crashedPeer')
    // stored in the same shape _reflectOptimisticUpdatesToStorage writes
    await t.pushToList(
      'optimisticUpdates',
      [{id: '#1', transaction: unsentUpdate}],
      'crashedPeer',
    )
  })
}

test('a crashed session with unsent updates is taken over and pushed to the backend', async () => {
  const adapter = new FrontMemoryAdapter()
  await seedCrashedSession(adapter)

  const applyUpdatesCalls: Array<{peerId: string; updates: Transaction[]}> = []
  const backend = createFakeBackend()
  Object.assign(backend, {
    async applyUpdates(args: {
      peerId: string
      updates: Transaction[]
    }): Promise<unknown> {
      applyUpdatesCalls.push(args)
      return {
        ok: true,
        hasUpdates: false,
        clock: 0,
        lastIncorporatedPeerClock: 1,
        peerId: args.peerId,
      }
    },
  })

  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: adapter,
    backend: backend as unknown as SaazBackInterface,
    peerId: 'p',
  })
  await front.ready
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  // the crashed session's unsent update was pushed — i.e. _loadClosedSessions
  // really executed the takeover instead of being skipped for lack of locks
  expect(
    applyUpdatesCalls.some(
      (c) =>
        c.peerId === 'crashedPeer' && c.updates.some((u) => u.peerClock === 1),
    ),
  ).toBe(true)

  front.teardown()
})
