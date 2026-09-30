import type {
  BackApplyUpdateOps,
  BackGetUpdateSinceClockResult,
  PeerPresenceState,
  PeerSubscribeCallback,
  SaazBackInterface,
  Schema,
  $IntentionalAny,
} from '../types'
import {SaazFront} from './SaazFront'
import {FrontStorage} from './FrontStorage'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'

jest.setTimeout(5000)

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {cellCount?: number}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

/** A backend that never advances lastIncorporatedPeerClock unless told to. */
class FakeBackend implements SaazBackInterface {
  lastIncorporatedPeerClock = -1
  async getUpdatesSinceClock(opts: {
    clock: number | null
    peerId: string
  }): Promise<BackGetUpdateSinceClockResult> {
    return {
      hasUpdates: false,
      clock: -1,
      lastIncorporatedPeerClock: this.lastIncorporatedPeerClock,
      peerId: opts.peerId,
    }
  }
  async getLastIncorporatedPeerClock(opts: {peerId: string}) {
    return {
      peerId: opts.peerId,
      lastIncorporatedPeerClock: this.lastIncorporatedPeerClock,
    }
  }
  async closePeer() {
    return {ok: true}
  }
  async applyUpdates(opts: BackApplyUpdateOps) {
    return {
      ok: true as const,
      hasUpdates: false as const,
      clock: -1,
      lastIncorporatedPeerClock: this.lastIncorporatedPeerClock,
      peerId: opts.peerId,
    }
  }
  async updatePresence(_opts: {peerId: string; presence: PeerPresenceState}) {
    return {ok: true as const}
  }
  async subscribe(_opts: {peerId: string}, _onUpdate: PeerSubscribeCallback) {
    return () => {}
  }
}

test('un-acked optimistic updates stay in front storage; acked ones are removed', async () => {
  const adapter = new FrontMemoryAdapter()
  const backend = new FakeBackend()
  const front = new SaazFront({
    schema,
    dbName: 'db',
    storageAdapter: adapter,
    backend,
    peerId: 'peer1',
  })
  await front.ready

  front.tx(undefined, (cell: {cellCount?: number}) => {
    cell.cellCount = 1
  })
  await front.waitForStorageSync()

  front.tx(undefined, (cell: {cellCount?: number}) => {
    cell.cellCount = 2
  })
  await front.waitForStorageSync()

  const storage = new FrontStorage('db', adapter)
  let stored = await storage.transaction((t) => t.getOptimisticUpdates('peer1'))
  expect(stored.map((t) => t.peerClock)).toEqual([0, 1])

  // now the backend acknowledges both
  backend.lastIncorporatedPeerClock = 1
  front.tx(undefined, (cell: {cellCount?: number}) => {
    cell.cellCount = 3
  })
  await front.waitForStorageSync()

  stored = await storage.transaction((t) => t.getOptimisticUpdates('peer1'))
  expect(stored.map((t) => t.peerClock)).toEqual([2])

  front.teardown()
})
