import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import {useT} from '@dreamerbird/studio/i18n'
import React, {useEffect, useRef, useState} from 'react'
import styled from 'styled-components'
import {stripEndMs} from './model'
import type {AnimationStrip} from './model'
import {commitAnimationStripTiming} from './storage'
import type {AnimationTracksObject} from './storage'

export const AnimationStripPropertiesPanel = styled.div`
  ${pointerEventsAutoInNormalMode};
  z-index: 10000;
  width: min(272px, calc(100vw - 16px));
  box-sizing: border-box;
  padding: 12px;
  color: var(--theatre-text-primary, #fff);
  background: var(--theatre-panel-bg, #282b2f);
  border: 1px solid var(--theatre-panel-border, #555);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
  font-size: 11px;
  cursor: default;

  header,
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  section {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 10px 0;
  }

  label {
    display: grid;
    gap: 4px;
  }

  input,
  button {
    color: inherit;
    background: var(--theatre-input-bg, #1d2024);
    border: 1px solid var(--theatre-panel-border, #555);
    border-radius: 4px;
    font: inherit;
    padding: 4px 6px;
  }

  input {
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  [role='alert'] {
    color: #ff9c92;
    margin: 8px 0;
  }
`

const fields = [
  ['start', 'pg.strips.timelineStart'],
  ['end', 'pg.strips.timelineEnd'],
  ['sourceIn', 'pg.strips.sourceIn'],
  ['sourceOut', 'pg.strips.sourceOut'],
] as const

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
}: {
  object: AnimationTracksObject
  strip: AnimationStrip
  name: string
  hint: string
  assetDurationMs: number
  onClose: () => void
}) {
  const t = useT()
  const original = {
    start: seconds(strip.startMs),
    end: seconds(stripEndMs(strip)),
    sourceIn: seconds(strip.sourceInMs),
    sourceOut: seconds(strip.sourceOutMs),
  }
  const [draft, setDraft] = useState(original)
  const [error, setError] = useState(false)
  const firstInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    firstInput.current?.focus({preventScroll: true})
  }, [])
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
  const duration = seconds(sourceOutMs - sourceInMs)

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        try {
          commitAnimationStripTiming(
            object,
            strip,
            {startMs, sourceInMs, sourceOutMs},
            assetDurationMs,
          )
          setError(false)
        } catch {
          setError(true)
        }
      }}
    >
      <header>
        <strong title={name}>{name}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('pg.strips.closeProperties')}
        >
          ×
        </button>
      </header>
      {hint && <div role="status">{hint}</div>}
      <section>
        {fields.map(([field, label]) => (
          <label key={field}>
            {t(label)}
            <input
              ref={field === 'start' ? firstInput : undefined}
              type="number"
              step="any"
              name={field}
              value={draft[field]}
              onChange={(event) => {
                const value = event.currentTarget.value
                setError(false)
                setDraft((current) => {
                  const next = {...current, [field]: value}
                  if (field === 'end') {
                    next.sourceOut = seconds(
                      milliseconds(next.end) -
                        milliseconds(next.start) +
                        milliseconds(next.sourceIn),
                    )
                  } else {
                    next.end = seconds(
                      milliseconds(next.start) +
                        (milliseconds(next.sourceOut) -
                          milliseconds(next.sourceIn)),
                    )
                  }
                  return next
                })
              }}
            />
          </label>
        ))}
      </section>
      {error && <div role="alert">{t('pg.strips.rangeError')}</div>}
      <footer>
        <output>{t('pg.strips.duration', {seconds: duration || '—'})}</output>
        <button
          type="submit"
          disabled={fields.every(([key]) => draft[key] === original[key])}
        >
          {t('pg.strips.apply')}
        </button>
      </footer>
    </form>
  )
}
