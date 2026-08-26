import {hashBytes} from './hash'
import type {EntryKind, LibraryBackend, LibraryEntry} from './types'

const DB_NAME = 'toybox-asset-library'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', {keyPath: 'id'})
        store.createIndex('kind', 'kind', {unique: false})
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB 实现的库后端:blobs 表存大二进制,entries 表存元数据 */
export class IndexedDBBackend implements LibraryBackend {
  private dbPromise: Promise<IDBDatabase> | undefined
  private urlCache = new Map<string, string>()

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDB())
  }

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const db = await this.db()
    const store = db.transaction('entries', 'readonly').objectStore('entries')
    const req = kind ? store.index('kind').getAll(kind) : store.getAll()
    return (await requestToPromise(req)) as LibraryEntry[]
  }

  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    const db = await this.db()
    const req = db
      .transaction('entries', 'readonly')
      .objectStore('entries')
      .get(id)
    return (await requestToPromise(req)) as LibraryEntry | undefined
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    const db = await this.db()
    const req = db
      .transaction('entries', 'readwrite')
      .objectStore('entries')
      .put(entry)
    await requestToPromise(req)
  }

  async deleteEntry(id: string): Promise<void> {
    const db = await this.db()
    const req = db
      .transaction('entries', 'readwrite')
      .objectStore('entries')
      .delete(id)
    await requestToPromise(req)
  }

  async putBlob(data: Blob): Promise<string> {
    const id = hashBytes(new Uint8Array(await data.arrayBuffer()))
    const db = await this.db()
    const req = db
      .transaction('blobs', 'readwrite')
      .objectStore('blobs')
      .put(data, id)
    await requestToPromise(req)
    return id
  }

  async getBlobUrl(blobId: string): Promise<string> {
    const cached = this.urlCache.get(blobId)
    if (cached) return cached
    const db = await this.db()
    const req = db
      .transaction('blobs', 'readonly')
      .objectStore('blobs')
      .get(blobId)
    const data = (await requestToPromise(req)) as Blob | undefined
    if (!data) throw new Error(`资产数据不存在: ${blobId}`)
    const url = URL.createObjectURL(data)
    this.urlCache.set(blobId, url)
    return url
  }

  async deleteBlob(blobId: string): Promise<void> {
    const cached = this.urlCache.get(blobId)
    if (cached) {
      URL.revokeObjectURL(cached)
      this.urlCache.delete(blobId)
    }
    const db = await this.db()
    const req = db
      .transaction('blobs', 'readwrite')
      .objectStore('blobs')
      .delete(blobId)
    await requestToPromise(req)
  }
}
