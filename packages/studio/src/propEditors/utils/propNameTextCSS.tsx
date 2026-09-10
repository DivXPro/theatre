import type {PropHighlighted} from '@dreamerbird/studio/panels/SequenceEditorPanel/whatPropIsHighlighted'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import type {RuleSet} from 'styled-components'
import {css} from 'styled-components'

// typed as RuleSet<any> so it can be interpolated into any styled component,
// whether or not that component declares $isHighlighted
export const propNameTextCSS: RuleSet<$IntentionalAny> = css<{
  $isHighlighted?: PropHighlighted
}>`
  font-weight: 300;
  font-size: 11px;
  color: ${(props) => (props.$isHighlighted === 'self' ? '#CCC' : '#919191')};
  text-shadow: 0.5px 0.5px 2px rgba(0, 0, 0, 0.3);
`
