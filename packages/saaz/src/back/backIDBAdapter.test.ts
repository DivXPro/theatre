import 'fake-indexeddb/auto'
import {BackIDBAdapter} from './BackIDBAdapter'

test('BackIDBAdapter persists values across instances (simulated reload)', async () => {
  const a1 = new BackIDBAdapter('back-test-db')
  await a1.set('snapshot', {op: {n: 1}, cell: {}})
  await a1.set('clock', 3)

  const a2 = new BackIDBAdapter('back-test-db')
  expect(await a2.get('snapshot')).toEqual({op: {n: 1}, cell: {}})
  expect(await a2.get('clock')).toBe(3)
  expect(await a2.get('missing')).toBeUndefined()
})

test('BackIDBAdapter accepts a promise as the db name', async () => {
  const a = new BackIDBAdapter(Promise.resolve('back-test-db-promise'))
  await a.set('clock', 7)
  expect(await a.get('clock')).toBe(7)
})
