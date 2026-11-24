import {useT} from '@dreamerbird/studio/i18n'
import React, {useState} from 'react'
import {AnimationStripOverlapError, stripEndMs} from './model'
import type {AnimationStrip} from './model'
import {commitAnimationStripTiming, moveAnimationStripToTrack} from './storage'
import type {AnimationTracksObject} from './storage'

const clipFields = [
  ['start', 'pg.strips.timelineStart'],
  ['end', 'pg.strips.timelineEnd'],
  ['repeat', 'pg.strips.repeat'],
] as const

const actionFields = [
  ['sourceIn', 'pg.strips.sourceIn'],
  ['sourceOut', 'pg.strips.sourceOut'],
] as const

const fields = [...clipFields, ...actionFields] as const

export function animationStripErrorMessage(
  t: ReturnType<typeof useT>,
  error: unknown,
): string {
  if (error instanceof AnimationStripOverlapError) {
    return error.message || t('pg.strips.overlap')
  }
  return t('pg.strips.rangeError')
}

function seconds(ms: number) {
  return Number.isFinite(ms) ? Number((ms / 1000).toFixed(9)).toString() : ''
}

function milliseconds(value: string) {
  return value.trim() === '' ? NaN : Number(value) * 1000
}

export function AnimationStripProperties({
  object,
  strip,
  name,
  hint,
  assetDurationMs,
  onClose,
  trackId,
  trackName,
  tracks = [],
  onEditAction,
}: {
  object: AnimationTracksObject
  strip: AnimationStrip
  name: string
  hint: string
  assetDurationMs: number
  onClose: () => void
  trackId?: string
  trackName?: string
  tracks?: readonly {id: string; name: string}[]
  onEditAction?: (strip: AnimationStrip) => void
}) {
  const t = useT()
  const original = {
    start: seconds(strip.startMs),
    end: seconds(stripEndMs(strip)),
    sourceIn: seconds(strip.sourceInMs),
    sourceOut: seconds(strip.sourceOutMs),
    repeat: String(strip.repeat ?? 1),
  }
  const [draft, setDraft] = useState(original)
  const [error, setError] = useState('')
  const startMs =
    draft.start === original.start ? strip.startMs : milliseconds(draft.start)
  const sourceInMs =
    draft.sourceIn === original.sourceIn
      ? strip.sourceInMs
      : milliseconds(draft.sourceIn)
  const sourceOutMs =
    draft.sourceOut === original.sourceOut
      ? strip.sourceOutMs
      : milliseconds(draft.sourceOut)
  const repeat = Number(draft.repeat)
  const duration = seconds((sourceOutMs - sourceInMs) * repeat)
  const dirty = fields.some(([key]) => draft[key] !== original[key])

  return (
    <form
      data-camera-strip-properties=""
      aria-label={t('pg.strips.properties')}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        try {
          commitAnimationStripTiming(
            object,
            strip,
            {
              startMs,
              sourceInMs,
              sourceOutMs,
              repeat: repeat === 1 ? undefined : repeat,
            },
            assetDurationMs,
          )
          setError('')
        } catch (error) {
          setError(animationStripErrorMessage(t, error))
        }
      }}
    >
      <header>
        <div className="title">
          <span className="eyebrow">{t('pg.strips.activeStrip')}</span>
          <strong title={name}>{name}</strong>
          {trackName && <span className="track">{trackName}</span>}
        </div>
        <button
          className="close"
          type="button"
          onClick={onClose}
          aria-label={t('pg.strips.closeProperties')}
        >
          ×
        </button>
      </header>
      {hint && (
        <div className="hint" role="status">
          {hint}
        </div>
      )}
      <fieldset>
        <legend>{t('pg.strips.clipSection')}</legend>
        {clipFields.map(([field, label]) => (
          <Field
            key={field}
            field={field}
            label={t(label)}
            draft={draft}
            setDraft={setDraft}
            setError={setError}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('pg.strips.actionSection')}</legend>
        {actionFields.map(([field, label]) => (
          <Field
            key={field}
            field={field}
            label={t(label)}
            draft={draft}
            setDraft={setDraft}
            setError={setError}
          />
        ))}
      </fieldset>
      {trackId && tracks.length > 1 && (
        <label className="track-select">
          {t('pg.strips.moveToTrack')}
          <select
            name="track"
            value={trackId}
            disabled={dirty}
            onChange={(event) => {
              try {
                moveAnimationStripToTrack(
                  object,
                  strip,
                  event.currentTarget.value,
                  assetDurationMs,
                )
                setError('')
              } catch (error) {
                setError(animationStripErrorMessage(t, error))
              }
            }}
          >
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <div role="alert">{error}</div>}
      <footer>
        <output>{t('pg.strips.duration', {seconds: duration || '—'})}</output>
        {onEditAction && (
          <button
            type="button"
            disabled={dirty}
            onClick={() => onEditAction(strip)}
          >
            {t('pg.strips.editAction')}
          </button>
        )}
        <button type="submit" disabled={!dirty}>
          {t('pg.strips.apply')}
        </button>
      </footer>
    </form>
  )
}

function Field({
  field,
  label,
  draft,
  setDraft,
  setError,
}: {
  field: (typeof fields)[number][0]
  label: string
  draft: Record<(typeof fields)[number][0], string>
  setDraft: React.Dispatch<
    React.SetStateAction<Record<(typeof fields)[number][0], string>>
  >
  setError: React.Dispatch<React.SetStateAction<string>>
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step={field === 'repeat' ? '1' : 'any'}
        min={field === 'repeat' ? '1' : '0'}
        name={field}
        value={draft[field]}
        onChange={(event) => {
          const value = event.currentTarget.value
          setError('')
          setDraft((current) => {
            const next = {...current, [field]: value}
            const nextRepeat = Number(next.repeat)
            if (field === 'end') {
              next.sourceOut = seconds(
                (milliseconds(next.end) - milliseconds(next.start)) /
                  nextRepeat +
                  milliseconds(next.sourceIn),
              )
            } else {
              next.end = seconds(
                milliseconds(next.start) +
                  (milliseconds(next.sourceOut) - milliseconds(next.sourceIn)) *
                    nextRepeat,
              )
            }
            return next
          })
        }}
      />
    </label>
  )
}
