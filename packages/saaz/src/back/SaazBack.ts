import {defer} from '@dreamerbird/utils/defer'
import {applyOptimisticUpdateToState} from '../shared/transactions'
import type {
  BackApplyUpdateOps,
  SaazBackInterface,
  BackStorageAdapter,
  BackGetUpdateSinceClockResult,
  Schema,
  $IntentionalAny,
  PeerSubscribeCallback,
  AllPeersPresenceState,
  PeerPresenceState,
  FullSnapshot,
} from '../types'
import {BackStorage} from './BackStorage'
import type {DebouncedFunc} from 'lodash-es'
import {cloneDeep, throttle} from 'lodash-es'
import {ensureStateIsUptodate as ensureOpStateIsUptodate} from '../shared/utils'
import {Atom} from '@dreamerbird/dataverse'
import deepEqual from '@dreamerbird/utils/deepEqual'

export default class SaazBack implements SaazBackInterface {
  private _dbName: string
  private _storage: BackStorage
  private _readyDeferred = defer<void>()
  private _dbState: FullSnapshot<$IntentionalAny> = {cell: {}, op: {}}
  private _clock: number | null = null
  private _peerStates: {
    [peerId in string]?: {
      lastIncorporatedPeerClock: number
    }
  } = {}
  private _subsribers: Array<PeerSubscribeCallback> = []
  private _schema: Schema<{$schemaVersion: number}>
  private _presenceState: Atom<AllPeersPresenceState> = new Atom({})
  private _schedulePresenseUpdate: DebouncedFunc<() => void>

  constructor(opts: {
    dbName: string
    storageAdapter: BackStorageAdapter
    schema: Schema<$IntentionalAny>
  }) {
    this._schema = opts.schema
    this._dbName = opts.dbName
    this._storage = new BackStorage({storageAdapter: opts.storageAdapter})

    void this._storage.ready.then(
      () => {
        const loaded = this._storage.loadedState
        if (loaded?.snapshot) {
          this._dbState = ensureOpStateIsUptodate(loaded.snapshot, this._schema)
        }
        if (typeof loaded?.clock === 'number') {
          this._clock = loaded.clock
        }
        this._readyDeferred.resolve()
      },
      (err) => {
        // The backend storage could not be loaded, so this backend is
        // unusable. Reject `ready` instead of hanging forever — consumers
        // (e.g. the persistence degradation path) observe this rejection.
        this._readyDeferred.reject(err)
      },
    )

    this._schedulePresenseUpdate = throttle(
      () => {
        this._callSubscribersForPresenceUpdate()
      },
      1000 / 30,
      {leading: true},
    )

    this._schedulePresenseUpdate.cancel()
  }

  get ready() {
    return this._readyDeferred.promise
  }

  get isReady(): boolean {
    return this._readyDeferred.status === 'resolved'
  }

  async getUpdatesSinceClock(opts: {
    clock: number | null
    peerId: string
  }): Promise<BackGetUpdateSinceClockResult> {
    await this._readyDeferred.promise
    return this._getUpdatesSinceClockSync(opts)
  }

  async applyUpdates(
    opts: BackApplyUpdateOps,
  ): Promise<
    ({ok: true} & BackGetUpdateSinceClockResult) | {ok: false; error: unknown}
  > {
    await this._readyDeferred.promise
    return this._applyUpdatesSync(cloneDeep(opts))
  }

  async subscribe(
    opts: {
      peerId: string
    },
    onUpdate: PeerSubscribeCallback,
  ): Promise<() => void> {
    await this._readyDeferred.promise
    return this._subscribeSync(cloneDeep(opts), onUpdate)
  }

  private _getUpdatesSinceClockSync(opts: {
    clock: number | null
    peerId: string
  }): BackGetUpdateSinceClockResult {
    if (!this.ready) {
      throw new Error('Backend is not ready')
    }

    const lastIncorporatedPeerClock =
      this._peerStates[opts.peerId]?.lastIncorporatedPeerClock ?? null

    const clock = this._clock ?? -1
    const {peerId} = opts

    if ((opts.clock ?? -1) === clock) {
      return {hasUpdates: false, peerId, clock, lastIncorporatedPeerClock}
    }

    return {
      hasUpdates: true,
      clock,
      lastIncorporatedPeerClock,
      peerId,
      snapshot: {
        type: 'Snapshot',
        value: this._dbState,
      },
    }
  }

  async getLastIncorporatedPeerClock(opts: {
    peerId: string
  }): Promise<{lastIncorporatedPeerClock: number | null; peerId: string}> {
    await this._readyDeferred.promise
    return {
      peerId: opts.peerId,
      lastIncorporatedPeerClock:
        this._peerStates[opts.peerId]?.lastIncorporatedPeerClock ?? null,
    }
  }

  async closePeer(opts: {peerId: string}): Promise<{ok: boolean}> {
    delete this._peerStates[opts.peerId]
    return {ok: true}
  }

  async updatePresence(opts: {
    peerId: string
    presence: PeerPresenceState
  }): Promise<{ok: true} | {ok: false; error: unknown}> {
    await this._readyDeferred.promise
    return this._updatePresenceSync(cloneDeep(opts))
  }

  private _updatePresenceSync(opts: {
    peerId: string
    presence: PeerPresenceState
  }): {ok: true} | {ok: false; error: unknown} {
    if (!this.ready) {
      throw new Error('Backend is not ready')
    }

    if (!deepEqual(this._presenceState.get()[opts.peerId], opts.presence)) {
      this._presenceState.setByPointer((p) => p[opts.peerId], opts.presence)
      this._schedulePresenseUpdate()
    }

    return {ok: true}
  }

  private _applyUpdatesSync(
    opts: BackApplyUpdateOps,
  ):
    | ({ok: true} & BackGetUpdateSinceClockResult)
    | {ok: false; error: unknown} {
    if (!this.ready) {
      throw new Error('Backend is not ready')
    }

    if (opts.updates.length === 0) {
      return {
        ok: true,
        ...this._getUpdatesSinceClockSync({
          clock: opts.backendClock,
          peerId: opts.peerId,
        }),
      }
    }

    if (!this._peerStates[opts.peerId]) {
      this._peerStates[opts.peerId] = {
        lastIncorporatedPeerClock: -1,
      }
    }
    const peerState = this._peerStates[opts.peerId]!

    // const rebasing = opts.backendClock !== this._clock

    let snapshotSoFar = ensureOpStateIsUptodate(this._dbState, this._schema)
    let lastAcknowledgedClock = peerState.lastIncorporatedPeerClock
    let backendClock = this._clock ?? -1

    // const updatesToIncorporate = []

    for (const update of opts.updates) {
      if (peerState.lastIncorporatedPeerClock >= update.peerClock) {
        continue
      }

      const snapshotBefore = snapshotSoFar
      try {
        const [opSnapshotAfter] = applyOptimisticUpdateToState(
          update,
          snapshotBefore,
          this._schema,
          true,
        )
        snapshotSoFar = opSnapshotAfter
      } catch (error) {
        // 无法回放的 update(旧开发版本/不兼容数据):跳过并照常确认。
        // 不确认的话它会永远卡在客户端队列里,每次同步都重试(且旧实现是
        // 整批抛错——同批后续好更新也永远落不了库)。跳过的数据丢失用
        // 告警显式记录,与前端 _applyPersistedTransaction 的跳过策略一致。
        console.warn(
          '[saaz-back] skipping an update that fails to replay ' +
            '(it may come from an older, incompatible version):',
          error,
        )
      }
      lastAcknowledgedClock = update.peerClock
      backendClock++
    }

    if (lastAcknowledgedClock !== peerState.lastIncorporatedPeerClock) {
      this._dbState = snapshotSoFar
      peerState.lastIncorporatedPeerClock = lastAcknowledgedClock
      this._clock = backendClock
      this._callSubscribersForBackendStateUpdate()
      // Save failures are handled inside BackStorage.save (its serialized
      // queue attaches a rejection handler, keeping them out of the
      // unhandled-rejection channel; the caller receives them via the returned
      // promise). We deliberately don't throw back into the op-apply flow —
      // the memory state is already committed and the next apply retries the
      // save. Task C8 wires an observable persistence-failure signal.
      void this._storage.save(this._dbState, this._clock)
    }

    const s = this._getUpdatesSinceClockSync({
      clock: opts.backendClock,
      peerId: opts.peerId,
    })

    return {
      ok: true,
      ...s,
    }
  }

  private _subscribeSync(
    opts: {peerId: string},
    onUpdate: PeerSubscribeCallback,
  ): () => void {
    this._subsribers.push(onUpdate)
    let unsubscribed = false
    const unsub = () => {
      if (unsubscribed) return
      unsubscribed = true
      const i = this._subsribers.indexOf(onUpdate)
      if (i !== -1) {
        this._subsribers.splice(i, 1)
      }
    }
    return unsub
  }

  private _callSubscribersForBackendStateUpdate() {
    this._schedulePresenseUpdate.cancel()
    for (const sub of this._subsribers) {
      sub({presence: this._presenceState.get(), shouldCheckForUpdates: true})
    }
  }

  private _callSubscribersForPresenceUpdate() {
    this._schedulePresenseUpdate.cancel()
    for (const sub of this._subsribers) {
      sub({presence: this._presenceState.get(), shouldCheckForUpdates: false})
    }
  }
}
