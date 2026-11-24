import {resolvePropLabel} from '@dreamerbird/core'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import type {PropTypeConfig} from '@dreamerbird/core/types/public'
import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {usePrism, useVal} from '@dreamerbird/react'
import {useI18n} from '@dreamerbird/studio/i18n'
import {KeyframeDiamond} from '@dreamerbird/studio/propEditors/PropertyKeyframeButton'
import {focusedProperty} from '@dreamerbird/studio/propEditors/propertyKeyframes'
import {encodePathToProp} from '@dreamerbird/utils/pathToProp'
import pointerDeep from '@dreamerbird/utils/pointerDeep'
import React, {useMemo} from 'react'
import styled from 'styled-components'
import type {SequenceEditorPanelLayout} from './layout/layout'
import {transportBarHeight} from './TransportBar'

export const propertyLaneHeight = 28

const Lane = styled.div`
  position: absolute;
  top: ${transportBarHeight}px;
  left: 0;
  height: ${propertyLaneHeight}px;
  display: grid;
  box-sizing: border-box;
  border-bottom: 1px solid var(--theatre-selected-border);
  background: var(--theatre-panel-bg);
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding: 0 5px 0 8px;
  color: var(--theatre-accent);
  background: var(--theatre-selected-bg);
  border-right: 1px solid var(--theatre-selected-border);

  select {
    flex: 1;
    min-width: 0;
    padding: 1px 2px;
    color: var(--theatre-text-primary);
    background: var(--theatre-selected-bg);
    font: inherit;
    border: 0;
    border-radius: 3px;
    text-overflow: ellipsis;
  }
`

const Button = styled.button`
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--theatre-accent);
  background: transparent;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--theatre-selected-bg);
  }
  &:focus-visible {
    outline: 1px solid var(--theatre-accent);
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`

const Track = styled.div`
  position: relative;
  min-width: 0;
  overflow: hidden;
  cursor: crosshair;
`

const Marker = styled(Button)`
  position: absolute;
  z-index: 1;
  top: 50%;
  transform: translate(-50%, -50%);
  &[aria-current='true'] {
    --diamond-fill: currentColor;
  }
`

const Playhead = styled.span`
  position: absolute;
  inset-block: 0;
  width: 1px;
  background: var(--theatre-accent);
  pointer-events: none;
`

const Hint = styled.span`
  display: block;
  padding: 7px 10px;
  color: var(--theatre-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

function numericProperties(
  config: PropTypeConfig,
  path: string[] = [],
  labels: string[] = [],
): Array<{
  path: string[]
  labels: string[]
  key: string
}> {
  if (config.hidden) return []
  if (config.type === 'number')
    return [{path, labels, key: encodePathToProp(path)}]
  if (config.type !== 'compound') return []
  return Object.entries(config.props).flatMap(([name, child]) => {
    const prop = child as PropTypeConfig
    const label =
      resolvePropLabel(prop.label) ??
      (name.length === 1 ? name.toUpperCase() : name)
    return numericProperties(prop, [...path, name], [...labels, label])
  })
}

export default function PropertyKeyframeLane({
  object,
  layoutP,
}: {
  object: SheetObject
  layoutP: Pointer<SequenceEditorPanelLayout>
}) {
  const {t, language} = useI18n()
  const config = useVal(object.template.configPointer)
  const properties = useMemo(
    () => numericProperties(config),
    [config, language],
  )
  const focus = useVal(focusedProperty.pointer)
  const active =
    (focus?.object === object &&
      properties.find(({key}) => key === focus.key)) ||
    properties[0]
  const sequence = object.sheet.getSequence()
  const {position, keys, left, width, clipped} = usePrism(
    () => ({
      position: val(sequence.positionPrism),
      keys: active
        ? sequence.publicApi.getKeyframes(
            pointerDeep(object.propsP, active.path) as Pointer<number>,
          )
        : [],
      left: val(layoutP.leftDims.width),
      width: val(layoutP.panelDims.width),
      clipped: val(layoutP.clippedSpace),
    }),
    [object, sequence, active?.key, layoutP],
  )

  const index = keys.findIndex((key) => key.position >= position)
  const previous = keys[index === -1 ? keys.length - 1 : index - 1]
  const next = keys[index + (keys[index]?.position === position ? 1 : 0)]
  const [visibleStart, visibleEnd] = clipped.range
  const markerX = (time: number) =>
    Math.min(clipped.width - 7, Math.max(7, clipped.fromUnitSpace(time)))
  const isVisible = (time: number) => time >= visibleStart && time <= visibleEnd
  const jump = (time: number) => {
    sequence.publicApi.pause()
    sequence.position = time
    if (!isVisible(time)) {
      const span = visibleEnd - visibleStart
      const start = Math.max(0, time - span / 2)
      clipped.setRange([start, start + span])
    }
  }
  const activeLabel = active?.labels.join(' · ')
  return (
    <Lane
      style={{width, gridTemplateColumns: `${left}px minmax(0, 1fr)`}}
      aria-label={t('keyframes.track')}
      role="group"
    >
      <Controls>
        <KeyframeDiamond />
        <select
          aria-label={t('keyframes.track')}
          value={active?.key ?? ''}
          disabled={!active}
          onChange={(event) =>
            focusedProperty.set({object, key: event.currentTarget.value})
          }
        >
          {!active && <option value="">{t('keyframes.track')}</option>}
          {properties.map(({key, labels}) => (
            <option key={key} value={key}>
              {labels.join(' · ')}
            </option>
          ))}
        </select>
        <Button
          type="button"
          title={t('keyframes.previous')}
          aria-label={t('keyframes.previous')}
          disabled={!previous}
          onClick={() => previous && jump(previous.position)}
        >
          ‹
        </Button>
        <Button
          type="button"
          title={t('keyframes.next')}
          aria-label={t('keyframes.next')}
          disabled={!next}
          onClick={() => next && jump(next.position)}
        >
          ›
        </Button>
      </Controls>
      <Track
        onClick={(event) => {
          if ((event.target as Element).closest('button')) return
          const x =
            event.clientX - event.currentTarget.getBoundingClientRect().left
          jump(sequence.closestGridPosition(clipped.toUnitSpace(x)))
        }}
      >
        {keys.length === 0 && active && <Hint>{t('keyframes.empty')}</Hint>}
        {keys.map((key) => {
          if (!isVisible(key.position)) return null
          const label = `${activeLabel} · ${sequence.positionFormatter.formatForPlayhead(
            key.position,
          )}`
          return (
            <Marker
              type="button"
              key={key.id}
              style={{left: markerX(key.position)}}
              aria-current={key.position === position}
              aria-label={label}
              title={label}
              onClick={() => jump(key.position)}
            >
              <KeyframeDiamond />
            </Marker>
          )
        })}
        {isVisible(position) && (
          <Playhead aria-hidden="true" style={{left: markerX(position)}} />
        )}
      </Track>
    </Lane>
  )
}
