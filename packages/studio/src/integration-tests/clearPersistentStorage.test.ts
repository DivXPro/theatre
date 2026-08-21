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
