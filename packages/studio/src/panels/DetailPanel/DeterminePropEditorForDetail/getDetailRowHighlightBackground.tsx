import type {PropHighlighted} from '@toy-box/studio/panels/SequenceEditorPanel/whatPropIsHighlighted'

export function getDetailRowHighlightBackground({
  isHighlighted,
}: {
  isHighlighted: PropHighlighted
}): string {
  return isHighlighted === 'self'
    ? '#1857a4'
    : isHighlighted === 'descendent'
      ? '#0a2f5c'
      : 'initial'
}
