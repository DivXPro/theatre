export type AnimationStrip = {
  id: string
  assetId: string
  startMs: number
  sourceInMs: number
  sourceOutMs: number
}

type AnimationTrack = {id: string; strips: AnimationStrip[]}
export type AnimationTracks = {version: 1; tracks: AnimationTrack[]}

export type AnimationTrackState =
  | {kind: 'legacy'}
  | {kind: 'tracks'; document: AnimationTracks}
  | {kind: 'invalid'}

export type AnimationStripEdit = 'move' | 'start' | 'end'
export type AnimationStripTiming = Pick<
  AnimationStrip,
  'startMs' | 'sourceInMs' | 'sourceOutMs'
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
  return strip.startMs + (strip.sourceOutMs - strip.sourceInMs)
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
    Number.isFinite(value.startMs + (value.sourceOutMs - value.sourceInMs))
  )
}

function isTrack(value: unknown): value is AnimationTrack {
  if (!isRecord(value) || !isId(value.id) || !Array.isArray(value.strips)) {
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

export function parseAnimationTracks(raw: string): AnimationTrackState {
  if (raw === '') return {kind: 'legacy'}
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.tracks)
    ) {
      return {kind: 'invalid'}
    }
    const tracks: unknown[] = value.tracks
    if (!tracks.length) return {kind: 'legacy'}
    if (tracks.length === 1 && tracks.every(isTrack)) {
      return {kind: 'tracks', document: {version: 1, tracks}}
    }
  } catch {
    return {kind: 'invalid'}
  }
  return {kind: 'invalid'}
}

function validateStrip(
  strip: AnimationStrip,
  others: AnimationStrip[],
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
  if (
    others.some(
      (other) =>
        other.id === strip.id ||
        (before(strip.startMs, stripEndMs(other)) &&
          before(other.startMs, stripEndMs(strip))),
    )
  ) {
    throw new Error('Animation strips on the same track cannot overlap')
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
  const track = state.kind === 'tracks' ? state.document.tracks[0] : undefined
  const strips = track?.strips ?? []
  validateStrip(strip, strips, assetDurationMs, sequenceLengthMs)
  return {
    version: 1,
    tracks: [
      {
        id: track?.id ?? trackId,
        strips: [...strips, strip].sort(
          (left, right) => left.startMs - right.startMs,
        ),
      },
    ],
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
  switch (edit) {
    case 'move':
      next.startMs = positionMs
      break
    case 'start':
      next.startMs = positionMs
      next.sourceInMs = original.sourceInMs + (positionMs - original.startMs)
      break
    case 'end':
      next.sourceOutMs = original.sourceInMs + (positionMs - original.startMs)
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
  validateStrip(
    next,
    document.tracks[0]!.strips.filter((strip) => strip.id !== original.id),
    assetDurationMs,
    sequenceLengthMs,
  )
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
        sourceTimeMs: strip.sourceInMs + Math.max(0, timeMs - strip.startMs),
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
