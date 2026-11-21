import type {ISequence, ISheetObject} from '@dreamerbird/core'
import type {AnimationClip} from 'three'
import type {AnimationTrackState} from './model'

export type AnimationStripSnapshot = {
  state: AnimationTrackState
  clips: ReadonlyMap<string, AnimationClip>
}

type Prepare = (
  startMs: number,
  endMs: number,
  signal: AbortSignal,
) => Promise<AnimationStripSnapshot>

type AnimationObject = Pick<ISheetObject, 'sheet'>
const sources = new WeakMap<ISequence, Map<AnimationObject, Prepare>>()
const active = new WeakMap<
  ISequence,
  ReadonlyMap<AnimationObject, AnimationStripSnapshot>
>()

export function registerAnimationStripExport(
  object: AnimationObject,
  prepare: Prepare,
): () => void {
  const sequence = object.sheet.sequence
  const entries = sources.get(sequence) ?? new Map<AnimationObject, Prepare>()
  sources.set(sequence, entries)
  entries.set(object, prepare)
  return () => {
    if (entries.get(object) === prepare) entries.delete(object)
  }
}

export function getAnimationStripSnapshot(
  object: AnimationObject,
): AnimationStripSnapshot | undefined {
  return active.get(object.sheet.sequence)?.get(object)
}

export async function prepareAnimationStripExport(
  sequence: ISequence,
  startMs: number,
  endMs: number,
  signal: AbortSignal,
): Promise<() => () => void> {
  const entries = [...(sources.get(sequence) ?? [])]
  const snapshots = new Map(
    await Promise.all(
      entries.map(
        async ([object, prepare]) =>
          [object, await prepare(startMs, endMs, signal)] as const,
      ),
    ),
  )
  return () => {
    active.set(sequence, snapshots)
    return () => {
      if (active.get(sequence) === snapshots) active.delete(sequence)
    }
  }
}
