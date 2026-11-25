import styled from 'styled-components'

const DetailPanelButton = styled.button<{disabled?: boolean}>`
  text-align: center;
  padding: 8px;
  border-radius: 2px;
  border: 1px solid var(--theatre-ui-selected-border, #627b7b87);
  background-color: var(--theatre-ui-selected, #4b787d3d);
  color: var(--theatre-ui-text, #eaeaea);
  font-weight: 400;
  display: block;
  appearance: none;
  flex-grow: 1;
  cursor: ${(props) => (props.disabled ? 'none' : 'pointer')};
  opacity: ${(props) => (props.disabled ? 0.4 : 1)};

  &:hover {
    background-color: var(--theatre-ui-hover, #7dc1c878);
    border-color: var(--theatre-ui-accent, #9ebcbf);
  }
`

export default DetailPanelButton
