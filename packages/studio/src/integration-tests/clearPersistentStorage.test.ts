import 'fake-indexeddb/auto'
import {deriveSaazNames} from '@toy-box/studio/StudioStore/saazNames'
import {clearPersistentStorageFor} from '@toy-box/studio/StudioStore/clearPersistentStorage'

test('clearPersistentStorage deletes the saaz IDB databases for the key', async () => {
  const {openDB} = await import('idb')
  const names = deriveSaazNames('theatrejs:0.4')
  const db = await openDB(names.frontDbName, 1, {
    upgrade(d) {
      d.createObjectStore('seed')
    },
  })
  db.close()

  await clearPersistentStorageFor('theatrejs:0.4')

  const dbs = await indexedDB.databases()
  expect(dbs.map((d) => d.name)).not.toContain(names.frontDbName)
  expect(dbs.map((d) => d.name)).not.toContain(names.backDbName)
})

test('clearPersistentStorage resolves even when a connection blocks the delete', async () => {
  const {openDB} = await import('idb')
  const names = deriveSaazNames('theatrejs:0.4-blocked')
  // hold the front DB open so `deleteDatabase` fires `blocked` for it
  const holder = await openDB(names.frontDbName, 1, {
    upgrade(d) {
      d.createObjectStore('seed')
    },
  })

  // must resolve (best-effort) instead of hanging forever on `blocked`
  await clearPersistentStorageFor('theatrejs:0.4-blocked')

  // release the holder so this test doesn't leak an open handle
  holder.close()
})
