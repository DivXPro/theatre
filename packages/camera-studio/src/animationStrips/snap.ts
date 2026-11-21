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
  clamp,
}: {
  edit: AnimationStripEdit
  strip: AnimationStrip
  positionMs: number
  radiusMs: number
  targetsMs: readonly number[]
  grid: (positionMs: number) => number
  preview: (positionMs: number) => AnimationStrip
  /** 把候选时间夹到素材/序列边界内；夹过的吸附目标不再显示为吸附 */
  clamp?: (positionMs: number) => number
}) {
  const offsets = edit === 'move' ? [0, stripEndMs(strip) - strip.startMs] : [0]
  const candidates = targetsMs
    .flatMap((snapMs) =>
      offsets.map((offset) => {
        const unboundedMs = snapMs - offset
        const candidateMs = clamp ? clamp(unboundedMs) : unboundedMs
        if (clamp && candidateMs !== unboundedMs) return null
        return {
          snapMs,
          candidateMs,
          distance: Math.abs(positionMs - candidateMs),
        }
      }),
    )
    .filter(
      (
        candidate,
      ): candidate is {
        snapMs: number
        candidateMs: number
        distance: number
      } => candidate !== null,
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
  const gridMs = grid(positionMs)
  const candidateMs = clamp ? clamp(gridMs) : gridMs
  return {snapMs: null, candidateMs, strip: preview(candidateMs)}
}
