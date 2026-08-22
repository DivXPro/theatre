import {defer} from '@toy-box/utils/defer'
import type {BackStorageAdapter, FullSnapshot, $IntentionalAny} from '../types'

// The idle value of the save queue. Referenced by identity so `save()` can
// detect "no save in flight" and start writing synchronously (see below).
const idleSaveQueue: Promise<void> = Promise.resolve()

export class BackStorage {
  private _readyD = defer<void>()
  private _adapter: BackStorageAdapter
  private _loadedState: {
    snapshot: FullSnapshot<$IntentionalAny> | null
    clock: number | null
  } | null = null
  // Serializes save() calls so concurrent writes reach the adapter in call
  // order — each save writes 'snapshot' then 'clock', and interleaving two
  // saves would corrupt the snapshot/clock pairing.
  private _saveQueue: Promise<void> = idleSaveQueue

  constructor(opts: {storageAdapter: BackStorageAdapter}) {
    this._adapter = opts.storageAdapter
    void this._load()
  }

  private async _load() {
    try {
      const [snapshot, clock] = await Promise.all([
        this._adapter.get<FullSnapshot<$IntentionalAny>>('snapshot'),
        this._adapter.get<number>('clock'),
      ])
      this._loadedState = {
        snapshot: snapshot ?? null,
        clock: typeof clock === 'number' ? clock : null,
      }
      this._readyD.resolve()
    } catch (err) {
      // A failed load means the backend can never restore its state. Reject
      // `ready` so consumers observe the degradation instead of hanging on a
      // never-settling promise (SaazBack propagates this rejection).
      this._readyD.reject(err)
    }
  }

  get ready() {
    return this._readyD.promise
  }

  get loadedState() {
    return this._loadedState
  }

  save(
    snapshot: FullSnapshot<$IntentionalAny>,
    clock: number | null,
  ): Promise<void> {
    const run = () => this._doSave(snapshot, clock)
    // When the queue is idle (the common case), start writing synchronously so
    // the first adapter write happens before `save()` returns — preserving the
    // pre-serialization timing that fire-and-forget callers (`_applyUpdatesSync`)
    // observe. Only when a save is already in flight do we chain, to keep
    // writes in call order.
    const p =
      this._saveQueue === idleSaveQueue ? run() : this._saveQueue.then(run)
    // Swallow the failure *for the queue* so a transient adapter error does
    // not poison later saves. The caller still receives the rejection via `p`
    // (and the attached handler keeps it out of the unhandled-rejection
    // channel).
    this._saveQueue = p.catch(() => undefined)
    return p
  }

  private async _doSave(
    snapshot: FullSnapshot<$IntentionalAny>,
    clock: number | null,
  ): Promise<void> {
    await this._adapter.set('snapshot', snapshot)
    await this._adapter.set('clock', clock)
  }
}
