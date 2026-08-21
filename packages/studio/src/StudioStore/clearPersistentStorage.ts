import {deleteDB} from 'idb'
import {deriveSaazNames} from './saazNames'

/** Deletes the locally persisted saaz state for the given persistence key. */
export async function clearPersistentStorageFor(
  persistenceKey: string,
): Promise<void> {
  const names = deriveSaazNames(persistenceKey)
  await Promise.all([deleteDB(names.frontDbName), deleteDB(names.backDbName)])
  try {
    localStorage.removeItem('theatrejs-studio-ahistoric')
    localStorage.removeItem(persistenceKey + 'auth')
  } catch (_) {}
}
