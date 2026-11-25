import styled from 'styled-components'
import BasicTooltip from './BasicTooltip'

const ErrorTooltip = styled(BasicTooltip)`
  --popover-outer-stroke: #e11c1c;
  --popover-inner-stroke: var(--theatre-ui-danger-surface, #2c1c1c);
  --popover-bg: var(--theatre-ui-danger-surface, #2c1c1c);
  pointer-events: none !important;
`

export default ErrorTooltip
