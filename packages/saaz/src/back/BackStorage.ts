import {defer} from '@toy-box/utils/defer'
import type {BackStorageAdapter, FullSnapshot, $IntentionalAny} from '../types'

export class BackStorage {
  private _readyD = defer<void>()
  private _adapter: BackStorageAdapter
  private _loadedState: {
    snapshot: FullSnapshot<$IntentionalAny> | null
    clock: number | null
  } | null = null

  constructor(opts: {storageAdapter: BackStorageAdapter}) {
    this._adapter = opts.storageAdapter
    void this._load()
  }

  private async _load() {
    const [snapshot, clock] = await Promise.all([
      this._adapter.get<FullSnapshot<$IntentionalAny>>('snapshot'),
      this._adapter.get<number>('clock'),
    ])
    this._loadedState = {
      snapshot: snapshot ?? null,
      clock: typeof clock === 'number' ? clock : null,
    }
    this._readyD.resolve()
  }

  get ready() {
    return this._readyD.promise
  }

  get loadedState() {
    return this._loadedState
  }

  async save(
    snapshot: FullSnapshot<$IntentionalAny>,
    clock: number | null,
  ): Promise<void> {
    await this._adapter.set('snapshot', snapshot)
    await this._adapter.set('clock', clock)
  }
}
