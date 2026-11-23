import {createHash} from 'node:crypto'
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import type {BackStorageAdapter} from '@dreamerbird/saaz'

type PersistedState = {[key: string]: unknown}

const isPersistedState = (value: unknown): value is PersistedState =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Stores one Saaz database as a JSON file. Writes go to a temporary file and
 * are atomically renamed into place, so a crash mid-write cannot leave a
 * truncated snapshot.
 */
export class BackFileAdapter implements BackStorageAdapter {
  readonly filePath: string
  private _state: Promise<PersistedState> | null = null
  private _writeQueue: Promise<void> = Promise.resolve()
  private _writeId = 0

  constructor(opts: {dir: string; dbName: string}) {
    const digest = createHash('sha256')
      .update(opts.dbName)
      .digest('hex')
      .slice(0, 16)
    const slug =
      opts.dbName
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'state'
    this.filePath = join(opts.dir, `${slug}-${digest}.json`)
  }

  private _getState(): Promise<PersistedState> {
    if (!this._state) {
      this._state = this._load()
    }
    return this._state
  }

  private async _load(): Promise<PersistedState> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedState(parsed)) {
      throw new Error(`Sync state file is not a JSON object: ${this.filePath}`)
    }
    return parsed
  }

  async get<T>(key: string): Promise<T | void> {
    const state = await this._getState()
    return state[key] as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    const write = this._writeQueue.then(async () => {
      const state = await this._getState()
      state[key] = value
      const serialized = JSON.stringify(state)
      const tempPath = `${this.filePath}.${process.pid}.${this._writeId++}.tmp`
      await mkdir(dirname(this.filePath), {recursive: true})
      try {
        await writeFile(tempPath, serialized, 'utf8')
        await rename(tempPath, this.filePath)
      } catch (error) {
        await rm(tempPath, {force: true}).catch(() => undefined)
        throw error
      }
    })

    // Keep later writes flowing even if this one fails; the caller still
    // receives the rejection through `write`.
    this._writeQueue = write.catch(() => undefined)
    return write
  }

  async close(): Promise<void> {
    // A single BackStorage.save() writes `snapshot` and then `clock` as two
    // chained set() calls. Wait until the queue stops growing so both halves
    // land on disk before shutdown.
    let previous: Promise<void>
    do {
      previous = this._writeQueue
      await previous
      await Promise.resolve()
    } while (previous !== this._writeQueue)
  }
}
