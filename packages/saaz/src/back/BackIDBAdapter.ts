import {openDB} from 'idb'
import type {IDBPDatabase} from 'idb'
import type {BackStorageAdapter} from '../types'

export class BackIDBAdapter implements BackStorageAdapter {
  private _dbPromise: Promise<IDBPDatabase>
  private _db: IDBPDatabase | null = null

  constructor(idbName: string | Promise<string>) {
    this._dbPromise = Promise.resolve(idbName).then((name) =>
      openDB(name, 1, {
        upgrade(db) {
          db.createObjectStore('keyval')
        },
      }),
    )
  }

  get ready() {
    return this._dbPromise.then(() => undefined)
  }

  /**
   * Releases the database connection. Idempotent; a close() that lands before
   * the connection has opened awaits the open first, so it still releases it.
   * Reads/writes after close() reject (the connection is closed).
   */
  async close(): Promise<void> {
    const db = this._db ?? (await this._dbPromise.catch(() => null))
    this._db = null
    db?.close()
  }

  async get<T>(key: string): Promise<T | void> {
    const db = await this._dbPromise
    return (await db.get('keyval', key)) as T | void
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this._dbPromise
    await db.put('keyval', value, key)
  }
}
