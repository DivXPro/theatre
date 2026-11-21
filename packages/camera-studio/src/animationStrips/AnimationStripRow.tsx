import {useVal} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {useT} from '@dreamerbird/studio/i18n'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {ConnectorLine} from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/Right/keyframeRowUI/ConnectorLine'
import useDrag from '@dreamerbird/studio/uiComponents/useDrag'
import usePopover from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import useContextMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useContextMenu'
import useRefAndState from '@dreamerbird/studio/utils/useRefAndState'
import React, {useEffect, useRef, useState} from 'react'
import styled from 'styled-components'
import {useLibraryEntries} from '../assetLibrary/library'
import type {AnimationEntry} from '../assetLibrary/types'
import {
  AnimationStripProperties,
  AnimationStripPropertiesPanel,
} from './AnimationStripProperties'
import {parseAnimationTracks, stripEndMs} from './model'
import type {AnimationStrip, AnimationStripEdit} from './model'
import {resolveStripDrag} from './snap'
import {
  appendAnimationStrip,
  commitAnimationStripEdit,
  previewAnimationStripEdit,
  removeAnimationStrip,
  removeAnimationTrack,
} from './storage'
import type {AnimationTracksObject} from './storage'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding-right: 8px;
  color: var(--theatre-text-secondary, #ccc);
  font-size: 11px;

  select {
    min-width: 0;
    max-width: 100%;
    flex: 1;
  }

  select,
  button {
    color: var(--theatre-text-primary, #fff);
    background: var(--theatre-panel-bg, #282b2f);
    border: 1px solid var(--theatre-panel-border, #555);
    border-radius: 3px;
    font: inherit;
  }
`

const Track = styled.div`
  position: relative;
  height: 100%;
`

const snapRadiusPx = 8

function timelineLeft(leftPadding: number, positionMs: number) {
  return `calc(${leftPadding}px + var(--unitSpaceToScaledSpaceMultiplier) * ${
    positionMs / 1000
  }px)`
}

const SnapGuide = styled.div`
  position: absolute;
  inset-block: 0;
  z-index: 2;
  width: 1px;
  background: #f3cc66;
  box-shadow: 0 0 4px #f3cc66;
  pointer-events: none;

  &::before,
  &::after {
    content: '';
    position: absolute;
    left: -4px;
    width: 9px;
    height: 2px;
    background: #f3cc66;
  }

  &::before {
    top: 0;
  }

  &::after {
    bottom: 0;
  }
`

const Span = styled.div<{$error: boolean; $selected: boolean}>`
  position: absolute;
  top: 50%;
  height: 18px;
  transform: translateY(-50%);
  cursor: grab;
  color: ${({$error, $selected}) =>
    $error
      ? '#ff9c92'
      : $selected
        ? '#f3cc66'
        : 'var(--theatre-text-primary, #fff)'};
  outline-offset: 3px;

  &:focus-visible {
    outline: 1px solid currentColor;
  }
`

const Label = styled.div`
  position: absolute;
  inset: 0 5px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  pointer-events: none;
  white-space: nowrap;
  font-size: 10px;
  text-shadow: 0 1px 2px #000;
`

const Edge = styled.span<{$side: 'start' | 'end'}>`
  position: absolute;
  top: 50%;
  ${({$side}) => ($side === 'start' ? 'left: 0;' : 'left: 100%;')}
  transform: translate(-50%, -50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: currentColor;
  cursor: ew-resize;
`

type RowProps = {object: AnimationTracksObject; rig: string | null}

export function AnimationStripHeader({object, rig}: RowProps) {
  const t = useT()
  const entries = useLibraryEntries('animation')
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const [error, setError] = useState('')
  const compatible = entries.filter(
    (entry): entry is AnimationEntry =>
      entry.kind === 'animation' && entry.rig === rig,
  )
  return (
    <Header>
      <span>{t('pg.strips.track')}</span>
      {state.kind === 'invalid' ? (
        <span role="status">{t('pg.strips.unreadable')}</span>
      ) : (
        <>
          <select
            aria-label={t('pg.strips.add')}
            title={t('pg.strips.add')}
            value=""
            disabled={!compatible.length}
            onChange={(event) => {
              const asset = compatible.find(
                (entry) => entry.id === event.target.value,
              )
              if (!asset) return
              try {
                const sequence = object.sheet.sequence
                appendAnimationStrip(
                  object,
                  asset.id,
                  asset.duration * 1000,
                  sequence.closestGridPosition(sequence.position) * 1000,
                )
                setError('')
              } catch {
                setError(t('pg.strips.rangeError'))
              }
            }}
          >
            <option value="">
              {t(compatible.length ? 'pg.strips.add' : 'pg.strips.noActions')}
            </option>
            {compatible.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          {state.kind === 'tracks' && (
            <button
              type="button"
              aria-label={t('pg.strips.removeTrack')}
              title={t('pg.strips.removeTrack')}
              onClick={() => {
                removeAnimationTrack(object)
                setError('')
              }}
            >
              ×
            </button>
          )}
          {error && (
            <span title={error} role="status">
              !
            </span>
          )}
        </>
      )}
    </Header>
  )
}

export function AnimationStripTrack({
  object,
  layout,
  statuses,
}: {
  object: AnimationTracksObject
  layout: Pointer<SequenceEditorPanelLayout>
  statuses: ReadonlyMap<string, 'loading' | 'error' | 'ready'>
}) {
  const entries = useLibraryEntries('animation')
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const [selectedStripId, selectStrip] = useState<string | null>(null)
  const strips =
    state.kind === 'tracks' ? state.document.tracks[0]!.strips : null
  const selected = strips?.some((strip) => strip.id === selectedStripId)
  useEffect(() => {
    if (!selected) selectStrip(null)
  }, [selected])
  if (!strips) return null
  const assets = new Map(entries.map((entry) => [entry.id, entry]))
  return (
    <Track
      onClick={(event) => {
        if (event.target === event.currentTarget) selectStrip(null)
      }}
    >
      {strips.map((strip) => {
        const asset = assets.get(strip.assetId)
        return (
          <Strip
            key={strip.id}
            object={object}
            layout={layout}
            strip={strip}
            strips={strips}
            selected={strip.id === selectedStripId}
            onSelect={() => selectStrip(strip.id)}
            onRemove={() => removeAnimationStrip(object, strip.id)}
            name={asset?.name ?? strip.assetId}
            assetDurationMs={
              asset?.kind === 'animation'
                ? asset.duration * 1000
                : strip.sourceOutMs
            }
            status={statuses.get(strip.assetId)}
          />
        )
      })}
    </Track>
  )
}

function Strip({
  object,
  layout,
  strip,
  strips,
  selected,
  onSelect,
  onRemove,
  name,
  assetDurationMs,
  status,
}: {
  object: AnimationTracksObject
  layout: Pointer<SequenceEditorPanelLayout>
  strip: AnimationStrip
  strips: readonly AnimationStrip[]
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  name: string
  assetDurationMs: number
  status: 'loading' | 'error' | 'ready' | undefined
}) {
  const t = useT()
  const [nodeRef, node] = useRefAndState<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<{
    strip: AnimationStrip
    invalid: boolean
    snapMs?: number | null
  } | null>(null)
  const [editError, setEditError] = useState(false)
  const active = useRef<{cancel: () => void} | null>(null)
  const leftPadding = useVal(layout.scaledSpace.leftPadding)
  const assetHint =
    status === 'error'
      ? t('pg.strips.assetError')
      : status === 'loading'
        ? t('pg.strips.loading')
        : ''
  const properties = usePopover(
    {debugName: 'AnimationStripProperties', closeWhenPointerIsDistant: false},
    () => (
      <AnimationStripPropertiesPanel
        role="dialog"
        aria-label={t('pg.strips.properties')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            closeProperties()
          }
        }}
      >
        <AnimationStripProperties
          key={`${strip.assetId}:${strip.startMs}:${strip.sourceInMs}:${strip.sourceOutMs}`}
          object={object}
          strip={strip}
          name={name}
          hint={status === 'ready' ? t('pg.strips.ready') : assetHint}
          assetDurationMs={assetDurationMs}
          onClose={closeProperties}
        />
      </AnimationStripPropertiesPanel>
    ),
  )
  const close = properties.close
  useEffect(() => {
    if (!selected && properties.isOpen) close('selection changed')
  }, [selected, close, properties.isOpen])

  function closeProperties() {
    properties.close('dismissed')
    node?.focus({preventScroll: true})
  }

  const [contextMenu] = useContextMenu(node, {
    displayName: name,
    items: () => [
      {
        type: 'normal',
        label: t('pg.strips.remove'),
        callback: onRemove,
      },
    ],
  })
  useDrag(node, {
    debugName: 'AnimationStrip',
    lockCSSCursorTo: 'ew-resize',
    onDragStart(event) {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
        return false
      onSelect()
      node?.focus({preventScroll: true})
      const action = (event.target as HTMLElement | null)?.dataset.stripEdit
      const edit: AnimationStripEdit =
        action === 'start' || action === 'end' ? action : 'move'
      const sequence = object.sheet.sequence
      const toUnitSpace = val(layout.scaledSpace.toUnitSpace)
      const initialMs = edit === 'end' ? stripEndMs(strip) : strip.startMs
      const neighboringEdges = strips
        .filter((other) => other.id !== strip.id)
        .flatMap((other) => [other.startMs, stripEndMs(other)])
      let candidate: number | undefined
      let cancelled = false
      let closeOnDrag = properties.isOpen
      const cancel = () => {
        cancelled = true
        setDraft(null)
      }
      active.current = {cancel}
      setEditError(false)
      return {
        onDrag(deltaX) {
          if (cancelled) return
          if (closeOnDrag) {
            closeOnDrag = false
            close('dragged strip')
          }
          try {
            const result = resolveStripDrag({
              strip,
              edit,
              positionMs: initialMs + toUnitSpace(deltaX) * 1000,
              radiusMs: toUnitSpace(snapRadiusPx) * 1000,
              targetsMs: [
                sequence.position * 1000,
                0,
                val(sequence.pointer.length) * 1000,
                ...neighboringEdges,
              ],
              grid: (timeMs) =>
                sequence.closestGridPosition(timeMs / 1000) * 1000,
              preview: (timeMs) =>
                previewAnimationStripEdit(
                  object,
                  strip,
                  edit,
                  timeMs,
                  assetDurationMs,
                ),
            })
            candidate = result.candidateMs
            setDraft({
              strip: result.strip,
              invalid: false,
              snapMs: result.snapMs,
            })
          } catch {
            candidate = undefined
            setDraft({strip, invalid: true})
          }
        },
        onDragEnd(didDrag) {
          active.current = null
          if (!node?.isConnected) return
          setDraft(null)
          if (cancelled || !didDrag || candidate === undefined) return
          try {
            commitAnimationStripEdit(
              object,
              strip,
              edit,
              candidate,
              assetDurationMs,
            )
          } catch {
            setEditError(true)
          }
        },
        onClick(event) {
          if (!cancelled && node?.isConnected) properties.open(event, node)
        },
      }
    },
  })
  const displayed = draft?.strip ?? strip
  const duration = (stripEndMs(displayed) - displayed.startMs) / 1000
  const error = Boolean(draft?.invalid || editError || status === 'error')
  const hint =
    draft?.invalid || editError ? t('pg.strips.rangeError') : assetHint
  const title = `${name} (${(displayed.startMs / 1000).toFixed(2)}–${(
    stripEndMs(displayed) / 1000
  ).toFixed(2)}s)${hint ? ` · ${hint}` : ''}`
  return (
    <>
      <Span
        ref={nodeRef}
        $error={error}
        $selected={selected}
        role="button"
        aria-pressed={selected}
        aria-haspopup="dialog"
        aria-expanded={selected && properties.isOpen}
        title={title}
        aria-label={title}
        tabIndex={0}
        onFocus={onSelect}
        style={{
          left: timelineLeft(leftPadding, displayed.startMs),
          width: `calc(var(--unitSpaceToScaledSpaceMultiplier) * ${duration}px)`,
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && (active.current || properties.isOpen)) {
            event.stopPropagation()
            if (active.current) active.current.cancel()
            else closeProperties()
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }
          if ((event.key === 'Enter' || event.key === ' ') && node) {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
            properties.open(undefined, node)
          }
        }}
      >
        <div style={{position: 'absolute', top: '50%', left: 0}}>
          <ConnectorLine
            isPopoverOpen={selected && properties.isOpen}
            isSelected={selected}
            connectorLengthInUnitSpace={duration}
          />
        </div>
        <Label>{name}</Label>
        <Edge $side="start" data-strip-edit="start" />
        <Edge $side="end" data-strip-edit="end" />
      </Span>
      {draft?.snapMs != null && (
        <SnapGuide
          aria-hidden="true"
          data-snap-guide=""
          style={{left: timelineLeft(leftPadding, draft.snapMs)}}
        />
      )}
      {selected && properties.node}
      {contextMenu}
    </>
  )
}
