import React from 'react'
import styled from 'styled-components'
import {getPointerParts, val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {usePrism} from '@dreamerbird/react'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import {encodePathToProp} from '@dreamerbird/utils/pathToProp'
import {useT} from '@dreamerbird/studio/i18n'
import {focusedProperty, togglePropertyKeyframe} from './propertyKeyframes'

export const KeyframeDiamond = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
    <path
      d="M6 1.5 10.5 6 6 10.5 1.5 6Z"
      stroke="currentColor"
      fill="var(--diamond-fill, none)"
    />
  </svg>
)

const Button = styled.button`
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--theatre-text-muted);
  cursor: pointer;

  &[data-keyframe-state='animated'],
  &[aria-pressed='true'] {
    color: var(--theatre-accent);
  }

  &[aria-pressed='true'] {
    --diamond-fill: currentColor;
    background: var(--theatre-selected-bg);
  }

  &:hover,
  &:focus-visible {
    background: var(--theatre-selected-bg);
  }
  &:focus-visible {
    outline: 1px solid var(--theatre-accent);
  }
`

const Field = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 1px 2px;
  border: 1px solid var(--theatre-panel-border);
  border-radius: 6px;
  background: var(--theatre-input-bg);

  &:focus-within,
  &[data-active='true'] {
    border-color: var(--theatre-selected-border);
  }

  > div {
    min-width: 0;
  }
  input {
    min-width: 0;
    padding-inline: 3px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

const Axis = styled.span`
  flex: none;
  padding-left: 4px;
  color: var(--theatre-text-muted);
  font: 10px monospace;

  &[data-axis='x'] {
    color: #d9a39c;
  }
  &[data-axis='y'] {
    color: #a9c8a2;
  }
  &[data-axis='z'] {
    color: #a3b8d6;
  }
`

export function PropertyKeyframeField({
  object,
  pointer,
  label,
  axis,
  children,
}: React.PropsWithChildren<{
  object: SheetObject
  pointer: Pointer<number>
  label: string
  axis?: string
}>) {
  const key = encodePathToProp(getPointerParts(pointer).path)
  const active = usePrism(() => {
    const focus = val(focusedProperty.pointer)
    return focus?.object === object && focus.key === key
  }, [object, key])
  return (
    <Field
      data-active={active}
      onFocusCapture={() => focusedProperty.set({object, key})}
    >
      {axis && <Axis data-axis={axis}>{axis.toUpperCase()}</Axis>}
      {children}
      <PropertyKeyframeButton object={object} pointer={pointer} label={label} />
    </Field>
  )
}

function PropertyKeyframeButton({
  object,
  pointer,
  label,
}: {
  object: SheetObject
  pointer: Pointer<number>
  label: string
}) {
  const t = useT()
  const sequence = object.sheet.getSequence()
  const {animated, current} = usePrism(() => {
    const position = val(sequence.positionPrism)
    const snapped = sequence.closestGridPosition(position)
    const keys = sequence.publicApi.getKeyframes(pointer)
    return {
      animated: keys.length > 0,
      current: keys.some(
        (key) => key.position === position || key.position === snapped,
      ),
    }
  }, [sequence, pointer])
  const action = t(current ? 'keyframes.remove' : 'keyframes.add')
  return (
    <Button
      type="button"
      aria-pressed={current}
      aria-label={`${label} · ${action}`}
      title={action}
      data-keyframe-state={current ? 'current' : animated ? 'animated' : 'none'}
      onClick={() => {
        focusedProperty.set({
          object,
          key: encodePathToProp(getPointerParts(pointer).path),
        })
        togglePropertyKeyframe(object, pointer)
      }}
    >
      <KeyframeDiamond />
    </Button>
  )
}
