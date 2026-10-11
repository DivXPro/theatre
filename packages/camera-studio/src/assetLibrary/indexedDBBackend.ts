import {hashBytes} from './hash'
import type {WritableLibrarySource} from './source'
import type {EntryKind, LibraryEntry, RigAlias} from './types'

const DB_VERSION = 2

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB 实现的库后端:blobs 表存大二进制,entries 表存元数据 */
export class IndexedDBBackend implements WritableLibrarySource {
  readonly id = 'idb'
  readonly capabilities = {writable: true} as const

  private readonly dbName: string
  private dbPromise: Promise<IDBDatabase> | undefined
  private urlCache = new Map<string, string>()

  constructor(opts: {dbName?: string} = {}) {
    this.dbName = opts.dbName ?? 'toybox-asset-library'
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('blobs'))
          db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', {keyPath: 'id'})
          store.createIndex('kind', 'kind', {unique: false})
        }
        if (!db.objectStoreNames.contains('rigAliases')) {
          db.createObjectStore('rigAliases', {keyPath: 'rig'})
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= this.openDB())
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

  async putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string> {
    const id = hashBytes(new Uint8Array(await data.arrayBuffer()))
    const db = await this.db()
    const req = db
      .transaction('blobs', 'readwrite')
      .objectStore('blobs')
      .put(data, id)
    await requestToPromise(req)
    // 本地 IDB 写入无进度概念;signal 对本地写同样忽略(不可中断)
    opts?.onProgress?.(1)
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

  async listBlobIds(): Promise<string[]> {
    const db = await this.db()
    const req = db
      .transaction('blobs', 'readonly')
      .objectStore('blobs')
      .getAllKeys()
    return (await requestToPromise(req)) as string[]
  }

  async getRigAliases(): Promise<RigAlias[]> {
    const db = await this.db()
    const req = db
      .transaction('rigAliases', 'readonly')
      .objectStore('rigAliases')
      .getAll()
    return (await requestToPromise(req)) as RigAlias[]
  }

  async putRigAlias(alias: RigAlias): Promise<void> {
    const db = await this.db()
    const req = db
      .transaction('rigAliases', 'readwrite')
      .objectStore('rigAliases')
      .put(alias)
    await requestToPromise(req)
  }
}
