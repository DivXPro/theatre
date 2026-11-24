import type {
  SequenceEditorTree_PrimitiveProp,
  SequenceEditorTree_PropWithChildren,
  SequenceEditorTree_Sheet,
  SequenceEditorTree_SheetObject,
} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/tree'
import type {VoidFn} from '@dreamerbird/core/types/public'
import {useT} from '@dreamerbird/studio/i18n'
import React, {useRef} from 'react'
import {HiOutlineChevronRight} from 'react-icons/hi'
import styled, {css} from 'styled-components'
import {usePropHighlightMouseEnter} from './usePropHighlightMouseEnter'

export const sequenceRowBaseIndent = 8
export const sequenceRowDepthIndent = 18
export const sequenceRowLeadingSlot = 22

export const sequenceRowPaddingLeft = (depth: number) =>
  sequenceRowBaseIndent + depth * sequenceRowDepthIndent

export const LeftRowContainer = styled.li<{$depth: number}>`
  --depth: ${(props) => props.$depth};
  margin: 0;
  padding: 0;
  list-style: none;
`

export const BaseHeader = styled.div<{$isEven: boolean}>`
  display: flex;
  align-items: center;
  min-width: 0;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(118, 149, 183, 0.04);
  background: ${(props) =>
    props.$isEven ? 'rgba(255, 255, 255, 0.012)' : 'transparent'};
`

export const sequenceRowLabelCSS = css`
  min-width: 0;
  overflow: hidden;
  color: var(--theatre-text-secondary);
  font-size: 11px;
  font-weight: 400;
  line-height: 28px;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: none;
`

export const SequenceRowLeadingSpacer = styled.span`
  flex: 0 0 ${sequenceRowLeadingSlot}px;
  width: ${sequenceRowLeadingSlot}px;
  height: 100%;
`

export const SequenceRowButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  gap: 4px;
  min-width: 0;
  height: 22px;
  margin: 0;
  padding: 0 7px;
  overflow: hidden;
  color: var(--theatre-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  outline: none;
  font: inherit;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--theatre-text-secondary);
    background: rgba(255, 255, 255, 0.055);
    border-color: rgba(255, 255, 255, 0.075);
  }

  &:focus-visible {
    outline: 1px solid var(--theatre-accent);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`

export const SequenceRowIconButton = styled(SequenceRowButton)`
  width: 22px;
  padding: 0;
  border-color: transparent;
  font-size: 0;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    border-color: transparent;
  }
`

const LeftRowHeader = styled(BaseHeader)<{
  $isSelectable: boolean
  $isSelected: boolean
}>`
  padding-right: 6px;
  padding-left: calc(
    ${sequenceRowBaseIndent}px + var(--depth) * ${sequenceRowDepthIndent}px
  );
  cursor: ${(props) => (props.$isSelectable ? 'pointer' : 'default')};

  &:hover {
    background: rgba(255, 255, 255, 0.026);
  }

  ${(props) =>
    props.$isSelected &&
    css`
      background: rgba(64, 170, 164, 0.13);
      box-shadow: inset 2px 0 0 var(--theatre-accent);

      &:hover {
        background: rgba(64, 170, 164, 0.17);
      }
    `}
`

const LeftRowHead_Label = styled.span`
  ${sequenceRowLabelCSS};
  flex: 1;
  padding-right: 4px;

  ${LeftRowHeader}:hover & {
    color: var(--theatre-text-primary);
  }
`

const LeftRowHead_Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
  gap: 2px;
  height: 100%;
  margin-left: auto;
`

const LeftRowHead_Icon = styled.button<{$isCollapsed: boolean}>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin: 0 4px 0 0;
  padding: 0;
  color: var(--theatre-text-muted);
  background: transparent;
  border: 0;
  border-radius: 3px;
  outline: none;
  cursor: pointer;

  svg {
    width: 11px;
    height: 11px;
    transition:
      transform 0.08s ease-out,
      color 0.1s ease-out;
    transform: rotateZ(${(props) => (props.$isCollapsed ? 0 : 90)}deg);
  }

  &:hover {
    color: var(--theatre-text-secondary);
    background: rgba(255, 255, 255, 0.055);
  }

  &:focus-visible {
    outline: 1px solid var(--theatre-accent);
  }
`

const LeftRowChildren = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`

const AnyCompositeRow: React.FC<{
  leaf:
    | SequenceEditorTree_Sheet
    | SequenceEditorTree_PrimitiveProp
    | SequenceEditorTree_PropWithChildren
    | SequenceEditorTree_SheetObject
  label: React.ReactNode
  toggleSelect?: VoidFn
  toggleCollapsed: VoidFn
  isSelected?: boolean
  isSelectable?: boolean
  isCollapsed: boolean
  headerActions?: React.ReactNode
  children?: React.ReactNode
}> = ({
  leaf,
  label,
  children,
  isSelectable,
  isSelected,
  toggleSelect,
  toggleCollapsed,
  isCollapsed,
  headerActions,
}) => {
  const t = useT()
  const hasChildren = Array.isArray(children) && children.length > 0

  const rowHeaderRef = useRef<HTMLDivElement | null>(null)

  usePropHighlightMouseEnter(rowHeaderRef.current, leaf)

  return leaf.shouldRender ? (
    <LeftRowContainer $depth={leaf.depth}>
      <LeftRowHeader
        ref={rowHeaderRef}
        style={{
          height: leaf.nodeHeight + 'px',
        }}
        $isSelectable={isSelectable === true}
        $isSelected={isSelected === true}
        onClick={toggleSelect}
        $isEven={leaf.n % 2 === 0}
      >
        <LeftRowHead_Icon
          type="button"
          aria-label={t(
            isCollapsed ? 'workspace.track.expand' : 'workspace.track.collapse',
          )}
          aria-expanded={!isCollapsed}
          $isCollapsed={isCollapsed}
          onClick={(event) => {
            event.stopPropagation()
            toggleCollapsed()
          }}
        >
          <HiOutlineChevronRight />
        </LeftRowHead_Icon>
        <LeftRowHead_Label
          title={typeof label === 'string' ? label : undefined}
        >
          {label}
        </LeftRowHead_Label>
        {headerActions && (
          <LeftRowHead_Actions>{headerActions}</LeftRowHead_Actions>
        )}
      </LeftRowHeader>
      {hasChildren && <LeftRowChildren>{children}</LeftRowChildren>}
    </LeftRowContainer>
  ) : null
}

export default AnyCompositeRow
