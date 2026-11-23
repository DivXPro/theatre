import {useT} from '@dreamerbird/studio/i18n'
import React, {useEffect, useRef, useState} from 'react'
import styled from 'styled-components'
import {useLibraryEntries} from '../assetLibrary/library'
import {resolveAnimationDuration} from './assetDuration'
import {
  AnimationStripPropertiesPanel,
  animationStripErrorMessage,
} from './AnimationStripProperties'
import {insertAnimationStrip, insertObjectAnimationStrip} from './storage'
import {objectAnimationChannels} from './model'
import type {AnimationTrackKind, ObjectAnimationChannel} from './model'
import type {AnimationTracksObject} from './storage'

const Dialog = styled(AnimationStripPropertiesPanel).attrs({as: 'dialog'})`
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(380px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  font-size: 13px;

  &::backdrop {
    background: rgb(0 0 0 / 55%);
  }

  &[data-modeless] {
    inset: auto 12px 34vh auto;
    margin: 0;
    max-height: calc(66vh - 12px);
  }

  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--theatre-panel-border, #555);

    label {
      display: flex;
      align-items: center;
    }
  }

  select {
    width: 100%;
    color: inherit;
    background: var(--theatre-input-bg, #1d2024);
    border: 1px solid var(--theatre-panel-border, #555);
    border-radius: 4px;
    padding: 4px 6px;
    font: inherit;
  }
`

export function AnimationStripDialog({
  label,
  onClose,
  children,
  modal = true,
  anchorTop,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
  modal?: boolean
  anchorTop?: number
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!modal) return
    const dialog = ref.current!
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [modal])
  return (
    <Dialog
      ref={ref}
      aria-label={label}
      open={modal ? undefined : true}
      data-modeless={modal ? undefined : ''}
      style={
        !modal && anchorTop !== undefined
          ? {
              bottom: `calc(100vh - ${anchorTop - 8}px)`,
              maxHeight: Math.max(0, anchorTop - 20),
            }
          : undefined
      }
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (!modal && event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {children}
    </Dialog>
  )
}

const channelLabels: Record<ObjectAnimationChannel, string> = {
  position: 'pg.strips.channelPosition',
  quaternion: 'pg.strips.channelQuaternion',
  scale: 'pg.strips.channelScale',
}

export function AddAnimationStripDialog({
  object,
  trackId,
  trackName,
  rig,
  trackKind = 'bone',
  onClose,
}: {
  object: AnimationTracksObject
  trackId: string
  trackName: string
  rig: string | null
  trackKind?: AnimationTrackKind
  onClose: () => void
}) {
  const t = useT()
  const isObjectTrack = trackKind === 'object'
  const entries = useLibraryEntries('animation')
  const compatible = entries.filter(
    (entry) => entry.kind === 'animation' && entry.rig === rig,
  )
  const [assetId, setAssetId] = useState('')
  const [start, setStart] = useState(() => {
    const sequence = object.sheet.sequence
    return String(
      Number(sequence.closestGridPosition(sequence.position).toFixed(9)),
    )
  })
  const [duration, setDuration] = useState(isObjectTrack ? '1' : '')
  const [repeat, setRepeat] = useState('1')
  const [channels, setChannels] = useState<ObjectAnimationChannel[]>([])
  const [error, setError] = useState('')
  const [resolvingDuration, setResolvingDuration] = useState(false)
  const asset = compatible.find((entry) => entry.id === assetId)
  const validDuration =
    Number.isFinite(Number(duration)) && Number(duration) > 0
  const canAdd = isObjectTrack
    ? channels.length > 0
    : asset?.kind === 'animation' && validDuration
  const label = t('pg.strips.addClip')
  useEffect(() => {
    if (!asset || asset.kind !== 'animation' || asset.duration > 0) {
      setResolvingDuration(false)
      return
    }
    let cancelled = false
    setDuration('')
    setResolvingDuration(true)
    setError('')
    void resolveAnimationDuration(asset).then(
      (resolved) => {
        if (cancelled) return
        setDuration(String(Number(resolved.toFixed(9))))
        setResolvingDuration(false)
      },
      () => {
        if (cancelled) return
        setError(t('pg.strips.assetError'))
        setResolvingDuration(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [asset, t])
  return (
    <AnimationStripDialog label={label} onClose={onClose}>
      <form
        onChange={() => setError('')}
        onSubmit={(event) => {
          event.preventDefault()
          if (!canAdd) return
          const timing = {
            startMs: Number(start) * 1000,
            sourceInMs: 0,
            sourceOutMs: Number(duration) * 1000,
            ...(repeat !== '1' ? {repeat: Number(repeat)} : {}),
          }
          try {
            if (isObjectTrack) {
              insertObjectAnimationStrip(object, trackId, timing, channels)
            } else if (asset?.kind === 'animation') {
              insertAnimationStrip(
                object,
                trackId,
                asset.id,
                asset.duration * 1000,
                timing,
              )
            }
          } catch (error) {
            setError(animationStripErrorMessage(t, error))
            return
          }
          onClose()
        }}
      >
        <header>
          <strong>{label}</strong>
        </header>
        <p>
          {object.address.objectKey} · {trackName}
        </p>
        {!isObjectTrack && !compatible.length ? (
          <p role="status">{t('pg.strips.noActionsHint')}</p>
        ) : (
          <>
            {isObjectTrack ? (
              <fieldset>
                <legend>{t('pg.strips.channels')}</legend>
                {objectAnimationChannels.map((channel) => (
                  <label key={channel}>
                    <input
                      type="checkbox"
                      value={channel}
                      checked={channels.includes(channel)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setChannels((current) =>
                          checked
                            ? [...current, channel]
                            : current.filter((entry) => entry !== channel),
                        )
                      }}
                    />
                    {t(channelLabels[channel])}
                  </label>
                ))}
              </fieldset>
            ) : (
              <label>
                {t('pg.strips.asset')}
                <select
                  required
                  value={assetId}
                  onChange={(event) => {
                    const id = event.currentTarget.value
                    const entry = compatible.find((item) => item.id === id)
                    setAssetId(id)
                    setDuration(
                      entry?.kind === 'animation' ? String(entry.duration) : '',
                    )
                  }}
                >
                  <option value="">{t('pg.strips.pickAsset')}</option>
                  {compatible.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <section>
              <label>
                {t('pg.strips.timelineStart')}
                <input
                  required
                  type="number"
                  name="start"
                  min="0"
                  step="any"
                  value={start}
                  onChange={(event) => setStart(event.currentTarget.value)}
                />
              </label>
              <label>
                {t('pg.strips.clipLength')}
                <input
                  required
                  type="number"
                  name="duration"
                  min="0"
                  step="any"
                  value={duration}
                  onChange={(event) => setDuration(event.currentTarget.value)}
                />
              </label>
              <label>
                {t('pg.strips.repeat')}
                <input
                  required
                  type="number"
                  name="repeat"
                  min="1"
                  step="1"
                  value={repeat}
                  onChange={(event) => setRepeat(event.currentTarget.value)}
                />
              </label>
            </section>
            {resolvingDuration && <p role="status">{t('pg.strips.loading')}</p>}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            {t('pg.strips.cancel')}
          </button>
          {(isObjectTrack || compatible.length > 0) && (
            <button type="submit" disabled={!canAdd}>
              {label}
            </button>
          )}
        </footer>
      </form>
    </AnimationStripDialog>
  )
}
