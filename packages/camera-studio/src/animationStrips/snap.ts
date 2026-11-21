import {stripEndMs} from './model'
import type {AnimationStrip, AnimationStripEdit} from './model'

export function resolveStripDrag({
  edit,
  strip,
  positionMs,
  radiusMs,
  targetsMs,
  grid,
  preview,
}: {
  edit: AnimationStripEdit
  strip: AnimationStrip
  positionMs: number
  radiusMs: number
  targetsMs: readonly number[]
  grid: (positionMs: number) => number
  preview: (positionMs: number) => AnimationStrip
}) {
  const offsets = edit === 'move' ? [0, stripEndMs(strip) - strip.startMs] : [0]
  const candidates = targetsMs
    .flatMap((snapMs) =>
      offsets.map((offset) => {
        const candidateMs = snapMs - offset
        return {
          snapMs,
          candidateMs,
          distance: Math.abs(positionMs - candidateMs),
        }
      }),
    )
    .filter(({distance}) => distance <= radiusMs)
    .sort((left, right) => left.distance - right.distance)

  for (const {snapMs, candidateMs} of candidates) {
    try {
      return {snapMs, candidateMs, strip: preview(candidateMs)}
    } catch {
      continue
    }
  }
  const candidateMs = grid(positionMs)
  return {snapMs: null, candidateMs, strip: preview(candidateMs)}
}
