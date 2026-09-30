import type {
  $IntentionalAny,
  FullSnapshot,
  OnDiskSnapshot,
  Schema,
} from '../types'
import {SaazFront} from './SaazFront'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'
import SaazBack from '../back/SaazBack'
import {BackMemoryAdapter} from '../back/BackMemoryAdapter'

jest.setTimeout(5000)

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

async function seedStorageWithSyncedState() {
  const frontAdapter = new FrontMemoryAdapter()
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
    peerId: 'oldPeer',
  })
  await front.ready
  front.tx((e) => e.setCount({to: 42}), undefined)
  await front.waitForBackendSync()
  await front.waitForStorageSync()
  front.teardown()
  return frontAdapter.export()
}

const diskSnapshot = (
  clock: number,
  count: number,
): OnDiskSnapshot<OpShape> => ({
  origin: 'file',
  dbName: 'd',
  clock,
  snapshot: {
    op: {$schemaVersion: 1, opCount: count},
    cell: {},
  } as FullSnapshot<OpShape>,
})

test('diskSnapshot wins when its clock is newer than the cached backend state', async () => {
  const stored = await seedStorageWithSyncedState() // backendClock 0, opCount 42
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FrontMemoryAdapter(stored),
    backend: new SaazBack({
      dbName: 'd',
      storageAdapter: new BackMemoryAdapter(),
      schema,
    }),
    diskSnapshot: diskSnapshot(5, 999),
  })
  await front.ready
  expect(front.state.op.opCount).toBe(999)
  front.teardown()
})

test('cached backend state wins when its clock is not older than the diskSnapshot', async () => {
  const stored = await seedStorageWithSyncedState()
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: new FrontMemoryAdapter(stored),
    backend: new SaazBack({
      dbName: 'd',
      storageAdapter: new BackMemoryAdapter(),
      schema,
    }),
    diskSnapshot: diskSnapshot(0, 999),
  })
  await front.ready
  expect(front.state.op.opCount).toBe(42)
  front.teardown()
})
