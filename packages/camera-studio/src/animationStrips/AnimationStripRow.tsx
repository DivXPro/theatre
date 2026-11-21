import {useVal} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {useT} from '@dreamerbird/studio/i18n'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
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
import {clampStripEditPosition, parseAnimationTracks, stripEndMs} from './model'
import type {AnimationStrip, AnimationStripEdit} from './model'
import {resolveStripDrag} from './snap'
import {
  appendAnimationStripAtPlayhead,
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
    height: 22px;
  }

  select,
  button {
    color: var(--theatre-text-primary, #fff);
    background: var(--theatre-panel-bg, #282b2f);
    border: 1px solid var(--theatre-panel-border, #555);
    border-radius: 3px;
    font: inherit;
  }

  select:not(:disabled) {
    border-style: dashed;
    cursor: pointer;
  }

  select:not(:disabled):hover {
    border-color: var(--theatre-text-secondary, #ccc);
    background: var(--theatre-panel-bg-hover, #33373c);
  }

  select:disabled {
    border-style: dashed;
    opacity: 0.65;
    cursor: default;
  }
`

const Track = styled.div`
  position: relative;
  height: 100%;
`

const EmptyAdd = styled.select`
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  height: 22px;
  max-width: 220px;
  padding: 0 6px;
  color: var(--theatre-text-secondary, #ccc);
  background: rgba(111, 183, 255, 0.06);
  border: 1px dashed rgba(111, 183, 255, 0.45);
  border-radius: 3px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--theatre-text-primary, #fff);
    background: rgba(111, 183, 255, 0.12);
    border-color: rgba(111, 183, 255, 0.8);
  }

  &:disabled {
    cursor: default;
    opacity: 0.65;
  }

  &[data-add-error='true'] {
    color: #ff9c92;
    border-color: #ff9c92;
  }
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
  height: 24px;
  transform: translateY(-50%);
  cursor: grab;
  color: ${({$error, $selected}) =>
    $error
      ? '#ff9c92'
      : $selected
        ? '#f3cc66'
        : 'var(--theatre-text-primary, #fff)'};
  background: ${({$error, $selected}) =>
    $error
      ? 'rgba(255, 122, 122, 0.16)'
      : $selected
        ? 'rgba(243, 204, 102, 0.14)'
        : 'rgba(111, 183, 255, 0.14)'};
  border: 1px solid
    ${({$error, $selected}) =>
      $error ? '#ff7a7a' : $selected ? '#f3cc66' : 'rgba(111, 183, 255, 0.5)'};
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  outline-offset: 3px;

  &:hover {
    background: ${({$error, $selected}) =>
      $error
        ? 'rgba(255, 122, 122, 0.22)'
        : $selected
          ? 'rgba(243, 204, 102, 0.2)'
          : 'rgba(111, 183, 255, 0.22)'};
  }

  &:focus-visible {
    outline: 2px solid currentColor;
  }
`

const Label = styled.div`
  position: absolute;
  inset: 0 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  pointer-events: none;
  white-space: nowrap;
  font-size: 10px;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
`

const Edge = styled.span<{$side: 'start' | 'end'}>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  ${({$side}) => ($side === 'start' ? 'left: 0;' : 'right: 0;')}
  background: rgba(0, 0, 0, 0.16);
  cursor: ew-resize;

  ${({$side}) =>
    $side === 'start'
      ? 'border-radius: 3px 0 0 3px;'
      : 'border-radius: 0 3px 3px 0;'}

  &:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  &::before,
  &::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 1px;
    height: 10px;
    transform: translateY(-50%);
    background: currentColor;
    opacity: 0.55;
  }

  &::before {
    left: 4px;
  }

  &::after {
    right: 4px;
  }
`

const ErrorBadge = styled.span`
  position: absolute;
  top: -5px;
  right: -5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  color: #1b1b1b;
  background: #ff7a7a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  pointer-events: none;
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
            title={t(
              compatible.length
                ? 'pg.strips.addHint'
                : 'pg.strips.noActionsHint',
            )}
            value=""
            disabled={!compatible.length}
            onChange={(event) => {
              const asset = compatible.find(
                (entry) => entry.id === event.target.value,
              )
              if (!asset) return
              try {
                appendAnimationStripAtPlayhead(
                  object,
                  asset.id,
                  asset.duration * 1000,
                )
                setError('')
              } catch {
                setError(t('pg.strips.rangeError'))
              }
            }}
          >
            <option value="">
              {compatible.length
                ? `＋ ${t('pg.strips.add')}`
                : t('pg.strips.noActions')}
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
  rig,
}: {
  object: AnimationTracksObject
  layout: Pointer<SequenceEditorPanelLayout>
  statuses: ReadonlyMap<string, 'loading' | 'error' | 'ready'>
  rig: string | null
}) {
  const t = useT()
  const entries = useLibraryEntries('animation')
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const [selectedStripId, selectStrip] = useState<string | null>(null)
  const [addError, setAddError] = useState(false)
  const strips =
    state.kind === 'tracks' ? state.document.tracks[0]!.strips : null
  const compatible = entries.filter(
    (entry): entry is AnimationEntry =>
      entry.kind === 'animation' && entry.rig === rig,
  )
  const selected = strips?.some((strip) => strip.id === selectedStripId)
  useEffect(() => {
    if (!selected) selectStrip(null)
  }, [selected])
  if (state.kind === 'invalid') return null
  const assets = new Map(entries.map((entry) => [entry.id, entry]))
  return (
    <Track
      onClick={(event) => {
        if (event.target === event.currentTarget) selectStrip(null)
      }}
    >
      {(!strips || strips.length === 0) && (
        <EmptyAdd
          aria-label={t('pg.strips.add')}
          title={
            addError
              ? t('pg.strips.rangeError')
              : t(
                  compatible.length
                    ? 'pg.strips.addHint'
                    : 'pg.strips.noActionsHint',
                )
          }
          value=""
          disabled={!compatible.length}
          data-add-error={addError}
          onChange={(event) => {
            const asset = compatible.find(
              (entry) => entry.id === event.target.value,
            )
            if (!asset) return
            try {
              appendAnimationStripAtPlayhead(
                object,
                asset.id,
                asset.duration * 1000,
              )
              setAddError(false)
            } catch {
              setAddError(true)
            }
          }}
        >
          <option value="">
            {compatible.length
              ? `＋ ${t('pg.strips.add')}`
              : t('pg.strips.noActions')}
          </option>
          {compatible.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </EmptyAdd>
      )}
      {strips?.map((strip) => {
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
              clamp: (timeMs) =>
                clampStripEditPosition(
                  strip,
                  edit,
                  timeMs,
                  assetDurationMs,
                  val(sequence.pointer.length) * 1000,
                ),
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
          if (cancelled || !didDrag) return
          if (candidate === undefined) {
            setEditError(true)
            return
          }
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
        <Label>{name}</Label>
        <Edge
          $side="start"
          data-strip-edit="start"
          title={t('pg.strips.trimStart')}
        />
        <Edge
          $side="end"
          data-strip-edit="end"
          title={t('pg.strips.trimEnd')}
        />
        {error && <ErrorBadge>!</ErrorBadge>}
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
