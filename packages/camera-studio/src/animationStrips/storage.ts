import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheetObject} from '@dreamerbird/core'
import {
  addStrip,
  editStrip,
  findFreeStripStart,
  parseAnimationTracks,
  updateStripTiming,
} from './model'
import type {
  AnimationStrip,
  AnimationStripEdit,
  AnimationStripTiming,
  AnimationTracks,
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
    set(object.props.animationTracks, document ? JSON.stringify(document) : '')
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
  const strip = {
    id: createId(),
    assetId,
    startMs,
    sourceInMs: 0,
    sourceOutMs: durationMs,
  }
  save(
    object,
    addStrip(
      state,
      strip,
      createId(),
      durationMs,
      val(object.sheet.sequence.pointer.length) * 1000,
    ),
  )
}

/**
 * 从当前播放头添加动作；已有片段占位时自动顺延到空闲处，避免
 * "点了添加却只出现一个错误提示"。
 */
export function appendAnimationStripAtPlayhead(
  object: AnimationTracksObject,
  assetId: string,
  durationMs: number,
): number {
  const state = parseAnimationTracks(val(object.props.animationTracks))
  const strips = state.kind === 'tracks' ? state.document.tracks[0]!.strips : []
  const sequence = object.sheet.sequence
  const sequenceLengthMs = val(sequence.pointer.length) * 1000
  const startMs = findFreeStripStart(
    strips,
    sequence.closestGridPosition(sequence.position) * 1000,
    durationMs,
    sequenceLengthMs,
  )
  appendAnimationStrip(object, assetId, durationMs, startMs)
  return startMs
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
  const track = document.tracks[0]!
  const current = track.strips.find((strip) => strip.id === original.id)
  if (
    !current ||
    current.assetId !== original.assetId ||
    current.startMs !== original.startMs ||
    current.sourceInMs !== original.sourceInMs ||
    current.sourceOutMs !== original.sourceOutMs
  ) {
    throw new Error('Animation strip changed during the edit')
  }
  const updated = update(
    document,
    current,
    val(object.sheet.sequence.pointer.length) * 1000,
  )
  if (
    updated.startMs === current.startMs &&
    updated.sourceInMs === current.sourceInMs &&
    updated.sourceOutMs === current.sourceOutMs
  )
    return
  const strips = track.strips
    .map((strip) => (strip.id === current.id ? updated : strip))
    .sort((left, right) => left.startMs - right.startMs)
  save(object, {version: 1, tracks: [{...track, strips}]})
}

export function removeAnimationStrip(
  object: AnimationTracksObject,
  stripId: string,
): void {
  const track = readDocument(object).tracks[0]!
  const strips = track.strips.filter((strip) => strip.id !== stripId)
  if (strips.length !== track.strips.length) {
    save(object, {version: 1, tracks: [{...track, strips}]})
  }
}

export function removeAnimationTrack(object: AnimationTracksObject): void {
  readDocument(object)
  save(object, null)
}
