import {deriveSaazNames} from './saazNames'

/**
 * Deletes an IDB database without hanging forever. `indexedDB.deleteDatabase`
 * fires `blocked` (and never settles) when another tab still holds a
 * connection open — idb's `deleteDB()` only resolves on `success`/`error`, so
 * passing `{blocked}` to it merely fires a callback. Resolving on `blocked`
 * makes the clear best-effort: the other tab keeps the DB alive until it
 * closes, and the caller isn't wedged.
 */
const deleteDatabaseBestEffort = (name: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onblocked = () => resolve()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

/** Deletes the locally persisted saaz state for the given persistence key. */
export async function clearPersistentStorageFor(
  persistenceKey: string,
): Promise<void> {
  const names = deriveSaazNames(persistenceKey)
  await Promise.all([
    deleteDatabaseBestEffort(names.frontDbName),
    deleteDatabaseBestEffort(names.backDbName),
  ])
  try {
    localStorage.removeItem('theatrejs-studio-ahistoric')
    localStorage.removeItem(persistenceKey + 'auth')
  } catch (_) {}
}
