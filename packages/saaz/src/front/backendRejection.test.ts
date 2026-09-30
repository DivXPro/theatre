/* eslint-disable no-restricted-syntax */
import type {$IntentionalAny, SaazBackInterface, Schema} from '../types'
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

const createFakeBackend = (reject: boolean): FakeBackend => {
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
      if (reject) return {ok: false, error: 'conflict'}
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const makeFront = (
  reject: boolean,
  onStorageFailure?: (error: Error) => void,
) =>
  new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FrontMemoryAdapter(),
    backend: createFakeBackend(reject) as unknown as SaazBackInterface,
    peerId: 'p',
    onStorageFailure,
  })

/**
 * `waitForBackendSync` resolves once the optimistic-update queue is empty.
 * Against the current implementation (a rejected update is never removed) this
 * hangs forever, so race it against a timeout to turn "infinite retry" into a
 * testable failure.
 */
const expectQueueDrains = (front: SaazFront<OpShape, Editors, {}, {}>) =>
  Promise.race([
    front.waitForBackendSync(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('optimistic queue never drained')),
        500,
      ),
    ),
  ])

test('a failing backend subscribe is logged, not an unhandled rejection', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  const backend = createFakeBackend(false) as $IntentionalAny
  backend.subscribe = async (): Promise<() => void> => {
    throw new Error('backend unreachable')
  }
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FrontMemoryAdapter(),
    backend: backend as SaazBackInterface,
    peerId: 'p',
  })

  try {
    await front.ready
    await flush()
    await flush()

    // the rejection is surfaced through the filtered error log
    expect(errorSpy).toHaveBeenCalled()

    // teardown's unsub path must not re-raise the rejected `stop` promise
    front.teardown()
    await flush()
    await flush()

    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
    errorSpy.mockRestore()
  }
})

test('dev: a backend-rejected update is fail-loud and dropped from the queue', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const front = makeFront(true)
  await front.ready
  await flush()

  front.tx((e) => e.setCount({to: 42}), undefined)

  // the rejected update must leave the queue instead of being retried forever
  await expectQueueDrains(front)

  // dev is fail-loud
  expect(errorSpy).toHaveBeenCalled()

  front.teardown()
  errorSpy.mockRestore()
})

test('prod: a backend-rejected update is dropped + signalled, without crashing', async () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const onStorageFailure = jest.fn()

  try {
    const front = makeFront(true, onStorageFailure)
    await front.ready
    await flush()

    // the edit is still optimistic (the backend hasn't acknowledged it)
    front.tx((e) => e.setCount({to: 42}), undefined)
    expect(front.state.op.opCount).toBe(42)

    // the rejected update is dropped from the queue rather than retried forever
    await expectQueueDrains(front)

    // the discarded update no longer contributes to the optimistic state — the
    // uncommitted edit is rolled back (spec:169 "丢弃该事务")
    expect(front.state.op.opCount).toBeUndefined()

    // the host is notified through the C8 persistence-failure signal
    expect(onStorageFailure).toHaveBeenCalled()

    // prod is not fail-loud
    expect(errorSpy).not.toHaveBeenCalled()

    front.teardown()
  } finally {
    process.env.NODE_ENV = originalNodeEnv
    errorSpy.mockRestore()
  }
})
