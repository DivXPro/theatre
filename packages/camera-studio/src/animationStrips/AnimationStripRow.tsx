import {useVal} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {useT} from '@dreamerbird/studio/i18n'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {
  sequenceRowLabelCSS,
  SequenceRowIconButton,
} from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow'
import useDrag from '@dreamerbird/studio/uiComponents/useDrag'
import useContextMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useContextMenu'
import useRefAndState from '@dreamerbird/studio/utils/useRefAndState'
import React, {useContext, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {PortalContext} from 'reakit'
import styled from 'styled-components'
import {useAnimationEntriesById} from '../assetLibrary/library'
import {getUiConfig} from '../uiConfig'
import {animationStripErrorMessage} from './AnimationStripProperties'
import {AddAnimationStripDialog} from './AnimationStripDialog'
import {
  clampStripEditPosition,
  inlineObjectActionId,
  parseAnimationTracks,
  stripEndMs,
} from './model'
import type {AnimationStrip, AnimationTrack, AnimationTrackKind} from './model'
import {resolveStripDrag} from './snap'
import {
  addAnimationTrack,
  commitAnimationStripEdit,
  previewAnimationStripEdit,
  removeAnimationStrip,
  removeAnimationTrack,
} from './storage'
import type {AnimationTracksObject} from './storage'
import {
  animationObjectAddressKey,
  animationStripSelectionB,
  clearAnimationStripSelection,
  selectAnimationStrip,
} from './stripSelection'
import {getStudioSync} from '@dreamerbird/core'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 100%;
  width: 100%;
  color: var(--theatre-text-secondary);
  font-size: 11px;

  > span {
    flex: 1;
    min-width: 0;
    ${sequenceRowLabelCSS};
    display: block;
  }
`

const ObjectActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
  gap: 2px;
  height: 100%;
  padding-right: 24px;
`

const AddTrackMenu = styled.div<{$top: number; $left: number}>`
  position: fixed;
  top: ${({$top}) => $top}px;
  left: ${({$left}) => $left}px;
  z-index: ${() => getUiConfig().zIndexBase + 1000};
  display: grid;
  min-width: 148px;
  padding: 4px;
  background: #25272e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
`

const AddTrackMenuItem = styled.button`
  display: flex;
  align-items: center;
  min-height: 24px;
  margin: 0;
  padding: 0 8px;
  color: var(--theatre-text-secondary);
  background: transparent;
  border: 0;
  border-radius: 3px;
  outline: none;
  font: inherit;
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--theatre-text-primary);
    background: rgba(255, 255, 255, 0.075);
  }
`

const HeaderStatus = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--theatre-text-muted);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
`

const TrackName = styled.span`
  ${sequenceRowLabelCSS};
  flex: 1;
  display: block;
`

const RemoveTrackButton = styled(SequenceRowIconButton)`
  &:hover:not(:disabled) {
    color: #e7a0a0;
    background: rgba(220, 90, 90, 0.12);
    border-color: rgba(220, 90, 90, 0.18);
  }
`

const Track = styled.div`
  position: relative;
  height: 100%;
`

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
)

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
  inset: 0 4px;
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

function AddAnimationTrackControl({
  object,
  canAddBone,
}: {
  object: AnimationTracksObject
  canAddBone: boolean
}) {
  const t = useT()
  const portalLayer = useContext(PortalContext)
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const unreadable = state.kind === 'invalid'
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{top: number; left: number} | null>(
    null,
  )
  const open = position !== null

  const closeMenu = (restoreFocus = false) => {
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const openMenu = (trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    const rect = trigger.getBoundingClientRect()
    if (!rect) return
    const menuWidth = 156
    const menuHeight = canAddBone ? 64 : 32
    const left = Math.max(
      6,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 6),
    )
    const below = rect.bottom + 4
    const top =
      below + menuHeight <= window.innerHeight
        ? below
        : Math.max(6, rect.top - menuHeight - 4)
    setPosition({top, left})
  }

  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({preventScroll: true})
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (
        (menuRef.current && path.includes(menuRef.current)) ||
        (triggerRef.current && path.includes(triggerRef.current))
      ) {
        return
      }
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
      }
    }
    const onViewportChange = () => closeMenu()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  const addTrack = (kind: AnimationTrackKind) => {
    closeMenu()
    addAnimationTrack(object, kind)
  }

  const moveMenuFocus = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    )
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    items[(current + delta + items.length) % items.length]?.focus()
  }

  return (
    <>
      <SequenceRowIconButton
        ref={triggerRef}
        type="button"
        aria-label={t('pg.strips.addTrack')}
        title={t('pg.strips.addTrack')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={unreadable}
        onClick={(event) => {
          event.stopPropagation()
          if (open) closeMenu()
          else openMenu(event.currentTarget)
        }}
      >
        <PlusIcon />
      </SequenceRowIconButton>
      {open &&
        createPortal(
          <AddTrackMenu
            ref={menuRef}
            $top={position.top}
            $left={position.left}
            role="menu"
            aria-label={t('pg.strips.addTrack')}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={moveMenuFocus}
          >
            {canAddBone && (
              <AddTrackMenuItem
                type="button"
                role="menuitem"
                onClick={() => addTrack('bone')}
              >
                {t('pg.strips.addBoneTrack')}
              </AddTrackMenuItem>
            )}
            <AddTrackMenuItem
              type="button"
              role="menuitem"
              onClick={() => addTrack('object')}
            >
              {t('pg.strips.addObjectTrack')}
            </AddTrackMenuItem>
          </AddTrackMenu>,
          portalLayer ?? getUiConfig().portalContainer ?? document.body,
        )}
    </>
  )
}

export function AnimationStripObjectActions({
  object,
  canAddBone,
}: {
  object: AnimationTracksObject
  canAddBone: boolean
}) {
  return (
    <ObjectActions
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <AddAnimationTrackControl object={object} canAddBone={canAddBone} />
    </ObjectActions>
  )
}

export function AnimationStripToolbar({
  object,
  legacyControl,
  status,
}: {
  object: AnimationTracksObject
  legacyControl?: React.ReactNode
  status?: string
}) {
  const t = useT()
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const unreadable = state.kind === 'invalid'
  const message = status || (unreadable ? t('pg.strips.unreadable') : '')
  return (
    <Header>
      {legacyControl}
      {message && (
        <HeaderStatus role="status" title={message}>
          {message}
        </HeaderStatus>
      )}
    </Header>
  )
}

function tracksForKind(
  tracks: readonly AnimationTrack[],
  kind: AnimationTrackKind,
  t: ReturnType<typeof useT>,
) {
  const label = t(
    kind === 'object' ? 'pg.strips.objectTrack' : 'pg.strips.boneTrack',
  )
  return tracks
    .filter((track) => (track.kind ?? 'bone') === kind)
    .map((track, index) => ({id: track.id, name: `${label} ${index + 1}`}))
}

export function AnimationStripHeader({
  object,
  trackId,
  rig,
  trackKind = 'bone',
}: {
  object: AnimationTracksObject
  trackId: string
  rig: string | null
  trackKind?: AnimationTrackKind
}) {
  const t = useT()
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const [adding, setAdding] = useState(false)
  const trackName =
    state.kind === 'tracks'
      ? tracksForKind(state.document.tracks, trackKind, t).find(
          (track) => track.id === trackId,
        )?.name
      : undefined
  if (!trackName) return null
  return (
    <Header>
      <TrackName title={trackName}>{trackName}</TrackName>
      <SequenceRowIconButton
        type="button"
        aria-label={t('pg.strips.addClip')}
        title={t('pg.strips.addClip')}
        onClick={() => setAdding(true)}
      >
        <PlusIcon />
      </SequenceRowIconButton>
      <RemoveTrackButton
        type="button"
        aria-label={t('pg.strips.removeTrack')}
        title={t('pg.strips.removeTrack')}
        onClick={() => removeAnimationTrack(object, trackId)}
      >
        <CloseIcon />
      </RemoveTrackButton>
      {adding && (
        <AddAnimationStripDialog
          object={object}
          trackId={trackId}
          trackName={trackName}
          trackKind={trackKind}
          rig={rig}
          onClose={() => setAdding(false)}
        />
      )}
    </Header>
  )
}

export function AnimationStripTrack({
  object,
  layout,
  statuses,
  trackId,
  trackKind = 'bone',
  onEditAction,
}: {
  object: AnimationTracksObject
  layout: Pointer<SequenceEditorPanelLayout>
  statuses: ReadonlyMap<string, 'loading' | 'error' | 'ready'>
  trackId: string
  trackKind?: AnimationTrackKind
  onEditAction?: (strip: AnimationStrip) => void
}) {
  const t = useT()
  const assets = useAnimationEntriesById()
  const state = parseAnimationTracks(useVal(object.props.animationTracks))
  const selection = useVal(animationStripSelectionB.prism)
  const selectionKey = animationObjectAddressKey(object.address)
  const selected =
    selection?.objectAddressKey === selectionKey ? selection.stripId : null
  const tracks = state.kind === 'tracks' ? state.document.tracks : []
  const track = tracks.find(
    (entry) => entry.id === trackId && (entry.kind ?? 'bone') === trackKind,
  )
  const allStrips = tracks.flatMap((entry) => entry.strips)
  const selectedExists = allStrips.some((strip) => strip.id === selected)
  useEffect(() => {
    if (selected && !selectedExists) clearAnimationStripSelection()
  }, [selected, selectedExists])
  if (!track) return null
  return (
    <Track
      onClick={(event) => {
        if (event.target === event.currentTarget) clearAnimationStripSelection()
      }}
    >
      {track.strips.map((strip) => {
        const asset = assets.get(strip.assetId)
        const isObjectAction =
          trackKind === 'object' && strip.assetId === inlineObjectActionId
        return (
          <Strip
            key={strip.id}
            object={object}
            layout={layout}
            strip={strip}
            strips={allStrips}
            selected={strip.id === selected}
            onSelect={() => {
              selectAnimationStrip(object.address, strip.id)
              getStudioSync()?.setSelection([object])
            }}
            onEditAction={onEditAction}
            onRemove={() => {
              removeAnimationStrip(object, strip.id)
              clearAnimationStripSelection()
            }}
            name={
              isObjectAction
                ? t('pg.strips.objectAction')
                : asset?.name ?? strip.assetId
            }
            assetDurationMs={
              asset?.kind === 'animation' && asset.duration > 0
                ? asset.duration * 1000
                : strip.sourceDurationMs ?? strip.sourceOutMs
            }
            status={isObjectAction ? undefined : statuses.get(strip.assetId)}
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
  onEditAction,
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
  onEditAction?: (strip: AnimationStrip) => void
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
    error?: string
    snapMs?: number | null
  } | null>(null)
  const [editError, setEditError] = useState('')
  const active = useRef<{cancel: () => void} | null>(null)
  const leftPadding = useVal(layout.scaledSpace.leftPadding)
  const assetHint =
    status === 'error'
      ? t('pg.strips.assetError')
      : status === 'loading'
        ? t('pg.strips.loading')
        : ''
  const editAction =
    onEditAction &&
    (() => {
      onSelect()
      onEditAction(strip)
    })

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
    lockCSSCursorTo: 'grabbing',
    onDragStart(event) {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
        return false
      const edit = 'move'
      const sequence = object.sheet.sequence
      const toUnitSpace = val(layout.scaledSpace.toUnitSpace)
      const initialMs = strip.startMs
      const neighboringEdges = strips
        .filter((other) => other.id !== strip.id)
        .flatMap((other) => [other.startMs, stripEndMs(other)])
      let candidate: number | undefined
      let candidateError = ''
      let cancelled = false
      const cancel = () => {
        cancelled = true
        setDraft(null)
      }
      active.current = {cancel}
      node?.focus({preventScroll: true})
      setEditError('')
      return {
        onDrag(deltaX) {
          if (cancelled) return
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
            candidateError = ''
            setDraft({
              strip: result.strip,
              snapMs: result.snapMs,
            })
          } catch (error) {
            candidate = undefined
            candidateError = animationStripErrorMessage(t, error)
            setDraft({strip, error: candidateError})
          }
        },
        onDragEnd(didDrag) {
          active.current = null
          if (!node?.isConnected) return
          setDraft(null)
          if (cancelled || !didDrag) return
          onSelect()
          if (candidate === undefined) {
            setEditError(candidateError || t('pg.strips.rangeError'))
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
          } catch (error) {
            setEditError(animationStripErrorMessage(t, error))
          }
        },
        onClick() {
          if (!cancelled && node?.isConnected) onSelect()
        },
      }
    },
  })
  const displayed = draft?.strip ?? strip
  const duration = (stripEndMs(displayed) - displayed.startMs) / 1000
  const error = Boolean(draft?.error || editError || status === 'error')
  const hint = draft?.error || editError || assetHint
  const label =
    (displayed.repeat ?? 1) > 1 ? `${name} ×${displayed.repeat}` : name
  const title = `${label} (${(displayed.startMs / 1000).toFixed(2)}–${(
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
        title={title}
        aria-label={title}
        tabIndex={0}
        onFocus={() => {
          if (!active.current) onSelect()
        }}
        onDoubleClick={
          editAction &&
          ((event) => {
            event.stopPropagation()
            editAction()
          })
        }
        style={{
          left: timelineLeft(leftPadding, displayed.startMs),
          width: `calc(var(--unitSpaceToScaledSpaceMultiplier) * ${duration}px)`,
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && active.current) {
            event.stopPropagation()
            active.current.cancel()
          } else if (event.key === 'Escape' && selected) {
            event.stopPropagation()
            clearAnimationStripSelection()
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
          }
        }}
      >
        <Label>{label}</Label>
        {error && <ErrorBadge>!</ErrorBadge>}
      </Span>
      {draft?.snapMs != null && (
        <SnapGuide
          aria-hidden="true"
          data-snap-guide=""
          style={{left: timelineLeft(leftPadding, draft.snapMs)}}
        />
      )}
      {contextMenu}
    </>
  )
}
