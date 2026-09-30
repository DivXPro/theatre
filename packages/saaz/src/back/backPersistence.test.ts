import SaazBack from './SaazBack'
import {BackMemoryAdapter} from './BackMemoryAdapter'
import type {$IntentionalAny, Schema, Transaction} from '../types'

jest.setTimeout(5000)

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

const tx = (peerClock: number): Transaction => ({
  invokations: [],
  generatorRecordings: {},
  peerId: 'p1',
  peerClock,
  draftOps: [],
})

test('SaazBack restores snapshot and clock from storage adapter', async () => {
  const adapter = new BackMemoryAdapter()
  const back1 = new SaazBack({dbName: 'd', storageAdapter: adapter, schema})
  await back1.ready
  await back1.applyUpdates({peerId: 'p1', backendClock: null, updates: [tx(0)]})

  // simulate a restart: new backend over the same (exported) storage state
  const back2 = new SaazBack({
    dbName: 'd',
    storageAdapter: new BackMemoryAdapter(adapter.export()),
    schema,
  })
  await back2.ready
  const res = await back2.getUpdatesSinceClock({clock: null, peerId: 'p2'})
  expect(res.clock).toBe(0)
  expect(res.hasUpdates).toBe(true)
  expect(back2.isReady).toBe(true)
})
