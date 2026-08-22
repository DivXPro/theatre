/* eslint-disable no-restricted-syntax */
import type {
  $IntentionalAny,
  FrontStorageAdapter,
  FrontStorageAdapterTransaction,
  SaazBackInterface,
  Schema,
} from '../types'
import {SaazFront} from './SaazFront'

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
 * A storage adapter whose reads/writes always fail, simulating IndexedDB being
 * unavailable. `close` is a no-op so teardown doesn't add an unhandled
 * rejection on top of the degraded state.
 */
class FailingFrontAdapter implements FrontStorageAdapter {
  async transaction<T>(
    _fn: (opts: FrontStorageAdapterTransaction) => Promise<T>,
  ): Promise<T> {
    throw new Error('IDB disabled')
  }
  async get<T>(_key: string, _session: string): Promise<T | void> {
    throw new Error('IDB disabled')
  }
  async getList<T extends {id: string}>(
    _key: string,
    _session: string,
  ): Promise<T[]> {
    throw new Error('IDB disabled')
  }
  async close(): Promise<void> {
    // no-op: best-effort, nothing to release
  }
}

test('init degrades to in-memory-only when storage fails, and editing still works', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const onStorageFailure = jest.fn()

  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FailingFrontAdapter(),
    backend: createFakeBackend() as unknown as SaazBackInterface,
    peerId: 'p',
    onStorageFailure,
  })
  // ready resolves even though persistence failed (previously it hung forever)
  await front.ready
  expect(onStorageFailure).toHaveBeenCalled()

  // editing is unaffected: the optimistic update still lands in front.state
  front.tx((e) => e.setCount({to: 42}), undefined)
  expect(front.state.op.opCount).toBe(42)

  front.teardown()

  warnSpy.mockRestore()
  errorSpy.mockRestore()
})
