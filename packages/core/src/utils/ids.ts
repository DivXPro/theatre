import type {KeyframeId, SequenceTrackId} from '@dreamerbird/core/types/public'

export function asKeyframeId(s: string): KeyframeId {
  return s as KeyframeId
}

export function asSequenceTrackId(s: string): SequenceTrackId {
  return s as SequenceTrackId
}
