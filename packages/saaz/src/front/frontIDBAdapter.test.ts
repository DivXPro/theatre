import 'fake-indexeddb/auto'
import {FrontIDBAdapter} from './FrontIdbAdapter'

test('FrontIDBAdapter.pluckFromList removes entries from the lists store', async () => {
  const a = new FrontIDBAdapter('front-pluck-test')
  await a.ready

  const session = 'peerA'
  const key = 'optimisticUpdates'
  const row = {id: 'tx-1', transaction: {foo: 'bar'}}

  await a.transaction(async (t) => {
    await t.pushToList(key, [row], session)
  })
  await a.transaction(async (t) => {
    expect(await t.getList(key, session)).toEqual([row])
  })

  const plucked = await a.transaction(async (t) => {
    return await t.pluckFromList(key, ['tx-1'], session)
  })
  // pluckFromList returns the stored rows (each is {id, transaction})
  expect(plucked).toEqual([row])

  // The `lists` object store's keyPath is `sessionAndKeyAndId`. Plucking must
  // delete by that key; deleting by the whole record silently no-ops in
  // fake-indexeddb (leaving the entry behind) while throwing a DataError in a
  // real browser's IndexedDB.
  await a.transaction(async (t) => {
    expect(await t.getList(key, session)).toEqual([])
  })
})

test('FrontIDBAdapter persists values across instances (simulated reload)', async () => {
  const a1 = new FrontIDBAdapter('front-persist-test')
  await a1.transaction(async (t) => {
    await t.set('sessionState', {backendClock: 3, snapshot: {n: 1}}, 'peerA')
  })

  const a2 = new FrontIDBAdapter('front-persist-test')
  await a2.transaction(async (t) => {
    expect(await t.get('sessionState', 'peerA')).toEqual({
      backendClock: 3,
      snapshot: {n: 1},
    })
    expect(await t.get('missing', 'peerA')).toBeUndefined()
  })
})

test('close() releases the connection: reads after close reject, close is idempotent', async () => {
  const a = new FrontIDBAdapter('front-close-test')
  await a.ready
  await a.close()

  await expect(
    a.transaction(async (t) => t.get('sessionState', 'peerA')),
  ).rejects.toThrow()

  // closing again is a no-op
  await expect(a.close()).resolves.toBeUndefined()
})
