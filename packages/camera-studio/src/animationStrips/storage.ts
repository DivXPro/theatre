import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheetObject} from '@dreamerbird/core'
import {isActionEditorChannels} from '../actionEditor/keys'
import type {ActionEditorCommit} from '../actionEditor/session'
import {
  addStrip,
  editStrip,
  editableActionFor,
  findAnimationStrip,
  inlineObjectActionId,
  parseAnimationTracks,
  updateStripTiming,
  validateAnimationStripUpdate,
} from './model'
import type {
  AnimationStrip,
  AnimationStripEdit,
  AnimationStripTiming,
  AnimationTrackKind,
  AnimationTracks,
  ObjectAnimationChannel,
} from './model'

export const animationTracksProp = t.string('', {hidden: true})
export type AnimationTracksObject = ISheetObject<{animationTracks: string}>

let nextId = 0
function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++nextId}`
}

function save(object: AnimationTracksObject, document: AnimationTracks | null) {
  const studio = getStudioSync()
  if (!studio) throw new Error('Studio is unavailable')
  studio.transaction(({set}) => {
    set(
      object.props.animationTracks,
      document ? JSON.stringify({...document, version: 2}) : '',
    )
  })
}

function readDocument(object: AnimationTracksObject): AnimationTracks {
  const state = parseAnimationTracks(val(object.props.animationTracks))
  if (state.kind !== 'tracks') throw new Error('Animation track is unavailable')
  return state.document
}

export function appendAnimationStrip(
  object: AnimationTracksObject,
  assetId: string,
  durationMs: number,
  startMs: number,
): void {
  const state = parseAnimationTracks(val(object.props.animationTracks))
  const track =
    state.kind === 'tracks'
      ? state.document.tracks.find((candidate) => candidate.kind !== 'object')
      : undefined
  const trackId = track?.id ?? createId()
  saveStrip(
    object,
    state.kind === 'tracks' && !track
      ? {kind: 'tracks', document: withTrack(state.document, trackId, 'bone')}
      : state,
    trackId,
    assetId,
    durationMs,
    {startMs, sourceInMs: 0, sourceOutMs: durationMs},
  )
}

function withTrack(
  document: AnimationTracks,
  id: string,
  kind: AnimationTrackKind,
): AnimationTracks {
  return {
    ...document,
    version: 2,
    tracks: [...document.tracks, {id, kind, strips: []}],
  }
}

export function addAnimationTrack(
  object: AnimationTracksObject,
  kind?: AnimationTrackKind,
): string | undefined {
  const state = parseAnimationTracks(val(object.props.animationTracks))
  if (state.kind === 'invalid') throw new Error('Unreadable animation tracks')
  if (state.kind === 'tracks' && kind === undefined) return
  const id = createId()
  save(
    object,
    withTrack(
      state.kind === 'tracks' ? state.document : {version: 2, tracks: []},
      id,
      kind ?? 'bone',
    ),
  )
  return id
}

export function insertAnimationStrip(
  object: AnimationTracksObject,
  trackId: string,
  assetId: string,
  durationMs: number,
  timing: AnimationStripTiming,
): string {
  const document = readDocument(object)
  if (
    !document.tracks.some(
      (track) => track.id === trackId && track.kind !== 'object',
    )
  ) {
    throw new Error('Animation track is unavailable')
  }
  return saveStrip(
    object,
    {kind: 'tracks', document},
    trackId,
    assetId,
    durationMs,
    timing,
  )
}

export function insertObjectAnimationStrip(
  object: AnimationTracksObject,
  trackId: string,
  timing: AnimationStripTiming,
  objectChannels: ObjectAnimationChannel[],
): string {
  const document = readDocument(object)
  if (
    !document.tracks.some(
      (track) => track.id === trackId && track.kind === 'object',
    )
  ) {
    throw new Error('Animation track is unavailable')
  }
  const durationMs = timing.sourceOutMs
  return saveStrip(
    object,
    {kind: 'tracks', document},
    trackId,
    inlineObjectActionId,
    durationMs,
    timing,
    {
      objectChannels,
      sourceDurationMs: durationMs,
    },
  )
}

function saveStrip(
  object: AnimationTracksObject,
  state: ReturnType<typeof parseAnimationTracks>,
  trackId: string,
  assetId: string,
  durationMs: number,
  timing: AnimationStripTiming,
  extra?: Pick<AnimationStrip, 'objectChannels' | 'sourceDurationMs'>,
): string {
  const strip = {
    id: createId(),
    assetId,
    ...timing,
    ...extra,
  }
  save(
    object,
    addStrip(
      state,
      strip,
      trackId,
      durationMs,
      val(object.sheet.sequence.pointer.length) * 1000,
    ),
  )
  return strip.id
}

export function previewAnimationStripEdit(
  object: AnimationTracksObject,
  original: AnimationStrip,
  edit: AnimationStripEdit,
  positionMs: number,
  durationMs: number,
): AnimationStrip {
  const document = readDocument(object)
  return editStrip(
    document,
    original,
    edit,
    positionMs,
    durationMs,
    val(object.sheet.sequence.pointer.length) * 1000,
  )
}

export function commitAnimationStripEdit(
  object: AnimationTracksObject,
  original: AnimationStrip,
  edit: AnimationStripEdit,
  positionMs: number,
  durationMs: number,
): void {
  commitStripUpdate(object, original, (document, current, sequenceLengthMs) =>
    editStrip(
      document,
      current,
      edit,
      positionMs,
      durationMs,
      sequenceLengthMs,
    ),
  )
}

export function commitAnimationStripTiming(
  object: AnimationTracksObject,
  original: AnimationStrip,
  timing: AnimationStripTiming,
  durationMs: number,
): void {
  commitStripUpdate(object, original, (document, current, sequenceLengthMs) =>
    updateStripTiming(document, current, timing, durationMs, sequenceLengthMs),
  )
}

function commitStripUpdate(
  object: AnimationTracksObject,
  original: AnimationStrip,
  update: (
    document: AnimationTracks,
    current: AnimationStrip,
    sequenceLengthMs: number,
  ) => AnimationStrip,
): void {
  const document = readDocument(object)
  const found = findAnimationStrip(document, original.id)
  if (!found || JSON.stringify(found.strip) !== JSON.stringify(original)) {
    throw new Error('Animation strip changed during the edit')
  }
  const {track, strip: current} = found
  const updated = update(
    document,
    current,
    val(object.sheet.sequence.pointer.length) * 1000,
  )
  if (JSON.stringify(updated) === JSON.stringify(current)) return
  const strips = track.strips
    .map((strip) => (strip.id === current.id ? updated : strip))
    .sort((left, right) => left.startMs - right.startMs)
  save(object, {
    ...document,
    tracks: document.tracks.map((entry) =>
      entry === track ? {...track, strips} : entry,
    ),
  })
}

export function moveAnimationStripToTrack(
  object: AnimationTracksObject,
  original: AnimationStrip,
  trackId: string,
  durationMs: number,
): void {
  const document = readDocument(object)
  const found = findAnimationStrip(document, original.id)
  const target = document.tracks.find((track) => track.id === trackId)
  if (!found || JSON.stringify(found.strip) !== JSON.stringify(original)) {
    throw new Error('Animation strip changed during the edit')
  }
  if (!target || (target.kind ?? 'bone') !== (found.track.kind ?? 'bone')) {
    throw new Error('Animation track is unavailable')
  }
  if (target === found.track) return
  validateAnimationStripUpdate(
    document,
    original,
    durationMs,
    val(object.sheet.sequence.pointer.length) * 1000,
    trackId,
  )
  save(object, {
    ...document,
    tracks: document.tracks.map((track) => {
      if (track === found.track)
        return {
          ...track,
          strips: track.strips.filter((strip) => strip.id !== original.id),
        }
      if (track === target)
        return {
          ...track,
          strips: [...track.strips, original].sort(
            (left, right) => left.startMs - right.startMs,
          ),
        }
      return track
    }),
  })
}

export function commitAnimationAction(
  object: AnimationTracksObject,
  original: AnimationStrip,
  commit: ActionEditorCommit,
  durationMs: number,
): void {
  const document = readDocument(object)
  const found = findAnimationStrip(document, commit.stripId)
  if (!found || JSON.stringify(found.strip) !== JSON.stringify(original)) {
    throw new Error('Animation strip changed during the edit')
  }
  if (
    !isActionEditorChannels(commit.channels, durationMs) ||
    commit.channels.some((channel) =>
      found.track.kind === 'object'
        ? channel.kind === 'bone' ||
          !found.strip.objectChannels?.includes(channel.kind)
        : channel.kind !== 'bone',
    )
  )
    throw new Error('Invalid action channels')
  const currentAction = editableActionFor(document, found.strip)
  const references = document.tracks.reduce(
    (count, track) =>
      count +
      track.strips.filter(
        (strip) => currentAction && strip.actionId === currentAction.id,
      ).length,
    0,
  )
  if (currentAction && (commit.scope === 'all' || references <= 1)) {
    save(object, {
      ...document,
      actions: document.actions?.map((action) =>
        action === currentAction
          ? {...action, channels: commit.channels}
          : action,
      ),
    })
    return
  }
  const actionId = createId()
  save(object, {
    ...document,
    actions: [
      ...(document.actions ?? []),
      {id: actionId, channels: commit.channels},
    ],
    tracks: document.tracks.map((track) =>
      track === found.track
        ? {
            ...track,
            strips: track.strips.map((strip) =>
              strip === found.strip ? {...strip, actionId} : strip,
            ),
          }
        : track,
    ),
  })
}

export function removeAnimationStrip(
  object: AnimationTracksObject,
  stripId: string,
): void {
  const document = readDocument(object)
  const found = findAnimationStrip(document, stripId)
  if (!found) return
  save(object, {
    ...document,
    tracks: document.tracks.map((track) =>
      track === found.track
        ? {
            ...track,
            strips: track.strips.filter((strip) => strip.id !== stripId),
          }
        : track,
    ),
  })
}

export function removeAnimationTrack(
  object: AnimationTracksObject,
  trackId: string,
): void {
  const document = readDocument(object)
  const tracks = document.tracks.filter((track) => track.id !== trackId)
  if (tracks.length !== document.tracks.length)
    save(object, tracks.length ? {...document, tracks} : null)
}
