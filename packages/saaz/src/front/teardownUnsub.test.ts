/* eslint-disable no-restricted-syntax */
import type {$IntentionalAny, SaazBackInterface, Schema} from '../types'
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

type FakeBackend = {
  subscribeCalled: boolean
  unsubscribeCalled: boolean
}

const createFakeBackend = (): FakeBackend & Record<string, unknown> => {
  const fake: FakeBackend & Record<string, unknown> = {
    subscribeCalled: false,
    unsubscribeCalled: false,
  }
  Object.assign(fake, {
    async subscribe(_opts: unknown, _onUpdate: unknown): Promise<() => void> {
      fake.subscribeCalled = true
      return () => {
        fake.unsubscribeCalled = true
      }
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

test('teardown stops the backend subscription', async () => {
  const fakeBackend = createFakeBackend()
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FrontMemoryAdapter(),
    backend: fakeBackend as unknown as SaazBackInterface,
  })
  await front.ready

  // `ready` flips when `initialized` is set, which happens right before the
  // teardown callbacks are registered — let _init finish pushing them.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fakeBackend.subscribeCalled).toBe(true)

  front.teardown()

  // the unsubscribe (returned by subscribe) must actually be invoked
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fakeBackend.unsubscribeCalled).toBe(true)
})
