export type AnimationTrackKind = 'bone' | 'object'
export type ObjectAnimationChannel = 'position' | 'quaternion' | 'scale'

export type AnimationStrip = {
  id: string
  assetId: string
  startMs: number
  sourceInMs: number
  sourceOutMs: number
  repeat?: number
  objectChannels?: ObjectAnimationChannel[]
  sourceDurationMs?: number
  actionId?: string
}

export type AnimationTrack = {
  id: string
  kind?: AnimationTrackKind
  strips: AnimationStrip[]
}
export type EditableAction = {
  id: string
  channels: readonly ActionEditorChannel[]
}
export type AnimationTracks = {
  version: 1 | 2
  tracks: AnimationTrack[]
  actions?: EditableAction[]
}

export type AnimationTrackState =
  | {kind: 'legacy'}
  | {kind: 'tracks'; document: AnimationTracks}
  | {kind: 'invalid'}

export type AnimationStripEdit = 'move' | 'start' | 'end'
export type AnimationStripTiming = Pick<
  AnimationStrip,
  'startMs' | 'sourceInMs' | 'sourceOutMs' | 'repeat'
>

type AnimationContribution = {
  trackId: string
  stripId: string
  assetId: string
  sourceTimeMs: number
  weight: number
}

const timeToleranceMs = 0.000001

function before(left: number, right: number): boolean {
  return left < right - timeToleranceMs
}

export function stripEndMs(strip: AnimationStrip): number {
  return (
    strip.startMs + (strip.sourceOutMs - strip.sourceInMs) * (strip.repeat ?? 1)
  )
}

export function sourceTimeAt(strip: AnimationStrip, sceneMs: number): number {
  if (before(sceneMs, strip.startMs)) return strip.sourceInMs
  if (!before(sceneMs, stripEndMs(strip))) return strip.sourceOutMs
  const cycleMs = strip.sourceOutMs - strip.sourceInMs
  const elapsed = Math.max(0, sceneMs - strip.startMs)
  const boundary = Math.round(elapsed / cycleMs) * cycleMs
  return (
    strip.sourceInMs +
    (Math.abs(elapsed - boundary) <= timeToleranceMs ? 0 : elapsed % cycleMs)
  )
}

export class AnimationStripOverlapError extends Error {}
export const objectAnimationChannels = [
  'position',
  'quaternion',
  'scale',
] as const
export const inlineObjectActionId = 'local:object-transform'

export function hasSkeletalStripLayer(state: AnimationTrackState): boolean {
  return (
    state.kind === 'invalid' ||
    (state.kind === 'tracks' &&
      state.document.tracks.some(
        (track) => track.kind !== 'object' && track.strips.length > 0,
      ))
  )
}

/**
 * 把拖动位置限制在素材和序列的可行范围内。端点拖出素材边界时不再
 * 静默失败，而是停在边界上，用户能明确看到"到头了"。
 */
export function clampStripEditPosition(
  strip: AnimationStrip,
  edit: AnimationStripEdit,
  positionMs: number,
  assetDurationMs: number,
  sequenceLengthMs: number,
): number {
  const minDurationMs = 1
  const repeat = strip.repeat ?? 1
  const durationMs = stripEndMs(strip) - strip.startMs
  switch (edit) {
    case 'move': {
      const maxStartMs = Math.max(0, sequenceLengthMs - durationMs)
      return Math.min(Math.max(0, positionMs), maxStartMs)
    }
    case 'start': {
      const minStartMs = Math.max(0, strip.startMs - strip.sourceInMs * repeat)
      const maxStartMs = Math.max(minStartMs, stripEndMs(strip) - minDurationMs)
      return Math.min(Math.max(minStartMs, positionMs), maxStartMs)
    }
    case 'end': {
      const minEndMs = strip.startMs + minDurationMs
      const maxEndMs = Math.max(
        minEndMs,
        Math.min(
          sequenceLengthMs,
          strip.startMs + (assetDurationMs - strip.sourceInMs) * repeat,
        ),
      )
      return Math.min(Math.max(minEndMs, positionMs), maxEndMs)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStrip(value: unknown): value is AnimationStrip {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isId(value.assetId) &&
    isTime(value.startMs) &&
    isTime(value.sourceInMs) &&
    isTime(value.sourceOutMs) &&
    before(value.sourceInMs, value.sourceOutMs) &&
    (value.repeat === undefined ||
      (typeof value.repeat === 'number' &&
        Number.isSafeInteger(value.repeat) &&
        value.repeat >= 1)) &&
    (value.objectChannels === undefined ||
      (Array.isArray(value.objectChannels) &&
        value.objectChannels.length > 0 &&
        value.objectChannels.every((channel) =>
          objectAnimationChannels.includes(channel),
        ))) &&
    (value.sourceDurationMs === undefined ||
      (isTime(value.sourceDurationMs) &&
        !before(value.sourceDurationMs, value.sourceOutMs))) &&
    (value.actionId === undefined || isId(value.actionId)) &&
    Number.isFinite(stripEndMs(value as AnimationStrip))
  )
}

function isTrack(value: unknown): value is AnimationTrack {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    !Array.isArray(value.strips) ||
    (value.kind !== undefined &&
      value.kind !== 'bone' &&
      value.kind !== 'object')
  ) {
    return false
  }
  const strips: unknown[] = value.strips
  if (!strips.every(isStrip)) return false
  return (
    new Set(strips.map((strip) => strip.id)).size === strips.length &&
    strips.every((strip, index) => {
      const previous = strips[index - 1]
      return !previous || !before(strip.startMs, stripEndMs(previous))
    })
  )
}

export function findAnimationStrip(document: AnimationTracks, stripId: string) {
  for (const track of document.tracks) {
    const strip = track.strips.find((candidate) => candidate.id === stripId)
    if (strip) return {track, strip}
  }
}

export function editableActionFor(
  document: AnimationTracks,
  strip: AnimationStrip,
) {
  return document.actions?.find((action) => action.id === strip.actionId)
}

function isEditableAction(value: unknown): value is EditableAction {
  return (
    isRecord(value) && isId(value.id) && isActionEditorChannels(value.channels)
  )
}

function stripGroups(
  track: AnimationTrack,
  strip: AnimationStrip,
): readonly string[] {
  return track.kind === 'object'
    ? strip.objectChannels ?? objectAnimationChannels
    : ['bone']
}

export function objectChannelsFor(
  strip: AnimationStrip,
): readonly ObjectAnimationChannel[] {
  return strip.objectChannels ?? objectAnimationChannels
}

function findConflict(
  tracks: readonly AnimationTrack[],
  target: AnimationTrack,
  strip: AnimationStrip,
) {
  const groups = stripGroups(target, strip)
  for (const track of tracks) {
    for (const other of track.strips) {
      if (other.id === strip.id) continue
      const startMs = Math.max(other.startMs, strip.startMs)
      const endMs = Math.min(stripEndMs(other), stripEndMs(strip))
      if (!before(startMs, endMs)) continue
      const group =
        track.id === target.id
          ? 'track'
          : stripGroups(track, other).find((channel) =>
              groups.includes(channel),
            )
      if (group) return {group, startMs, endMs}
    }
  }
}

export function parseAnimationTracks(raw: string): AnimationTrackState {
  if (raw === '') return {kind: 'legacy'}
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      (value.version !== 1 && value.version !== 2) ||
      !Array.isArray(value.tracks)
    ) {
      return {kind: 'invalid'}
    }
    const tracks: unknown[] = value.tracks
    if (!tracks.length) return {kind: 'legacy'}
    const actions = value.actions
    if (
      actions !== undefined &&
      (!Array.isArray(actions) ||
        !actions.every(isEditableAction) ||
        new Set(actions.map((action) => action.id)).size !== actions.length)
    ) {
      return {kind: 'invalid'}
    }
    if (tracks.every(isTrack)) {
      const strips = tracks.flatMap((track) => track.strips)
      if (
        new Set(tracks.map((track) => track.id)).size === tracks.length &&
        new Set(strips.map((strip) => strip.id)).size === strips.length &&
        !tracks.some((track) =>
          track.strips.some(
            (strip) =>
              (strip.actionId &&
                !actions?.some((action) => action.id === strip.actionId)) ||
              findConflict(tracks, track, strip),
          ),
        )
      )
        return {
          kind: 'tracks',
          document: {
            version: value.version,
            tracks,
            ...(actions ? {actions} : {}),
          },
        }
    }
  } catch {
    return {kind: 'invalid'}
  }
  return {kind: 'invalid'}
}

function byStart(left: AnimationStrip, right: AnimationStrip): number {
  return left.startMs - right.startMs
}

function validateStrip(
  strip: AnimationStrip,
  track: AnimationTrack,
  tracks: AnimationTrack[],
  assetDurationMs: number,
  sequenceLengthMs: number,
): void {
  if (
    !isStrip(strip) ||
    !isTime(assetDurationMs) ||
    !isTime(sequenceLengthMs) ||
    before(assetDurationMs, strip.sourceOutMs) ||
    before(sequenceLengthMs, stripEndMs(strip))
  ) {
    throw new Error('Invalid animation strip range')
  }
  const conflict = findConflict(tracks, track, strip)
  if (conflict) {
    throw new AnimationStripOverlapError(
      `Animation strips overlap on ${conflict.group} (${(
        conflict.startMs / 1000
      ).toFixed(2)}–${(conflict.endMs / 1000).toFixed(2)} s)`,
    )
  }
}

export function addStrip(
  state: AnimationTrackState,
  strip: AnimationStrip,
  trackId: string,
  assetDurationMs: number,
  sequenceLengthMs: number,
): AnimationTracks {
  if (state.kind === 'invalid') throw new Error('Unreadable animation tracks')
  const tracks =
    state.kind === 'tracks'
      ? state.document.tracks
      : [{id: trackId, strips: []}]
  const track = tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new Error('Animation track is unavailable')
  if (
    tracks.some((entry) => entry.strips.some((other) => other.id === strip.id))
  ) {
    throw new Error('Animation strip already exists')
  }
  validateStrip(strip, track, tracks, assetDurationMs, sequenceLengthMs)
  return {
    ...(state.kind === 'tracks' ? state.document : undefined),
    version: 2,
    tracks: tracks.map((entry) =>
      entry === track
        ? {...track, strips: [...track.strips, strip].sort(byStart)}
        : entry,
    ),
  }
}

export function editStrip(
  document: AnimationTracks,
  original: AnimationStrip,
  edit: AnimationStripEdit,
  positionMs: number,
  assetDurationMs: number,
  sequenceLengthMs: number,
): AnimationStrip {
  const next = {...original}
  const repeat = original.repeat ?? 1
  switch (edit) {
    case 'move':
      next.startMs = positionMs
      break
    case 'start':
      next.startMs = positionMs
      next.sourceInMs =
        original.sourceInMs + (positionMs - original.startMs) / repeat
      break
    case 'end':
      next.sourceOutMs =
        original.sourceInMs + (positionMs - original.startMs) / repeat
      break
  }
  return updateStripTiming(
    document,
    original,
    next,
    assetDurationMs,
    sequenceLengthMs,
  )
}

export function updateStripTiming(
  document: AnimationTracks,
  original: AnimationStrip,
  timing: AnimationStripTiming,
  assetDurationMs: number,
  sequenceLengthMs: number,
): AnimationStrip {
  const next = {...original, ...timing}
  if (Math.abs(next.sourceInMs) <= timeToleranceMs) next.sourceInMs = 0
  if (Math.abs(next.sourceOutMs - assetDurationMs) <= timeToleranceMs) {
    next.sourceOutMs = assetDurationMs
  }
  return validateAnimationStripUpdate(
    document,
    next,
    assetDurationMs,
    sequenceLengthMs,
  )
}

export function validateAnimationStripUpdate(
  document: AnimationTracks,
  next: AnimationStrip,
  assetDurationMs: number,
  sequenceLengthMs: number,
  targetTrackId?: string,
): AnimationStrip {
  const track =
    targetTrackId === undefined
      ? findAnimationStrip(document, next.id)?.track
      : document.tracks.find((entry) => entry.id === targetTrackId)
  if (!track) throw new Error('Animation track is unavailable')
  validateStrip(next, track, document.tracks, assetDurationMs, sequenceLengthMs)
  return next
}

export function evaluateStrips(
  document: AnimationTracks,
  timeMs: number,
): AnimationContribution[] {
  const contributions: AnimationContribution[] = []
  for (const track of document.tracks) {
    const strip = track.strips.find(
      (candidate) =>
        !before(timeMs, candidate.startMs) &&
        before(timeMs, stripEndMs(candidate)),
    )
    if (strip) {
      contributions.push({
        trackId: track.id,
        stripId: strip.id,
        assetId: strip.assetId,
        sourceTimeMs: sourceTimeAt(strip, timeMs),
        weight: 1,
      })
    }
  }
  return contributions
}

export function stripsInRange(
  document: AnimationTracks,
  startMs: number,
  endMs: number,
): AnimationStrip[] {
  return document.tracks.flatMap((track) =>
    track.strips.filter(
      (strip) =>
        !before(endMs, strip.startMs) && before(startMs, stripEndMs(strip)),
    ),
  )
}
import {isActionEditorChannels} from '../actionEditor/keys'
import type {ActionEditorChannel} from '../actionEditor/keys'
