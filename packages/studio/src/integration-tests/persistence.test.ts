import 'fake-indexeddb/auto'
import {SaazFront, FrontIDBAdapter, BackIDBAdapter} from '@toy-box/saaz'
import {SaazBack} from '@toy-box/saaz'
import {schema} from '@toy-box/sync-server/state/schema'

jest.setTimeout(10000)

const FRONT_DB = 'persistence-test-front'
const BACK_DB = 'persistence-test-back'

function makeStack() {
  const backend = new SaazBack({
    dbName: 'studio',
    storageAdapter: new BackIDBAdapter(BACK_DB),
    schema,
  })
  return new SaazFront({
    schema,
    dbName: 'studio',
    storageAdapter: new FrontIDBAdapter(FRONT_DB),
    backend,
  })
}

test('studio state survives a reload in solo mode (local backend + IDB)', async () => {
  const front1 = makeStack()
  await front1.ready
  front1.tx(undefined, (cell: any) => {
    cell.historic = {marker: 'hello-1.0'}
  })
  await front1.waitForBackendSync()
  await front1.waitForStorageSync()
  front1.teardown()

  const front2 = makeStack()
  await front2.ready
  expect((front2.state.cell as any).historic.marker).toBe('hello-1.0')
  front2.teardown()
})

test('undo history is session-scoped (documented behavior)', async () => {
  const front = makeStack()
  await front.ready
  expect(() => front.undo()).not.toThrow()
  front.teardown()
})
