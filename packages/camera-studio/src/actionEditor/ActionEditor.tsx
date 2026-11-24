import {useT} from '@dreamerbird/studio/i18n'
import React, {useEffect, useState, useSyncExternalStore} from 'react'
import {Euler, Quaternion} from 'three'
import {
  channelId,
  sameKeyTime,
  type ActionEditorChannelRef,
  type ActionEditorKeyRef,
  type ActionEditorQuaternion,
  type ActionEditorXYZ,
} from './keys'
import {channelLabel} from './labels'
import {
  hasActionEditorPreview,
  type ActionEditorScope,
  type ActionEditorSession,
} from './session'

export type ActionEditorProps = {
  session: ActionEditorSession
  className?: string
  onRequestBoneGizmo?: () => void
  poseEditing?: boolean
  locked?: boolean
  viewportControls?: {record: () => void; cancel: () => void}
}

const seconds = (timeMs: number) => String(Number((timeMs / 1000).toFixed(9)))

const timeValue = (timeMs: number, fps?: number) =>
  fps ? Number(((timeMs * fps) / 1000).toFixed(4)) : Number(seconds(timeMs))

function timeInMilliseconds(value: number, session: ActionEditorSession) {
  const {durationMs, framesPerSecond} = session
  const time = (value * 1000) / (framesPerSecond || 1)
  if (value === timeValue(durationMs, framesPerSecond))
    return framesPerSecond && Number.isInteger(value)
      ? Math.min(time, durationMs)
      : durationMs
  return time
}

const position = (timeMs: number, durationMs: number) =>
  ({'--ae-time': `${(100 * timeMs) / durationMs}%`}) as React.CSSProperties

function targets(
  session: ActionEditorSession,
  selectedBone: string | null,
): ActionEditorChannelRef[] {
  const bones = session
    .getSnapshot()
    .channels.flatMap((channel) =>
      channel.kind === 'bone' ? [channel.boneName] : [],
    )
  if (selectedBone && !bones.includes(selectedBone)) bones.push(selectedBone)
  return [
    ...session.objectChannels.map((kind) => ({kind})),
    ...bones.map((boneName) => ({kind: 'bone' as const, boneName})),
  ]
}

export function ActionEditorTimeline({
  session,
  className,
  locked,
  poseEditing,
}: ActionEditorProps) {
  const t = useT()
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  if (snapshot.status !== 'open') return null
  const {localTimeMs, selectedKey} = snapshot
  const {durationMs, framesPerSecond: fps, sourceInMs, sourceOutMs} = session
  const localTimeLabel = t(
    fps ? 'pg.actionEditor.localFrame' : 'pg.actionEditor.localTime',
  )
  const current = timeValue(localTimeMs, fps)
  const end = timeValue(durationMs, fps)
  const seekFrame = (frame: number) =>
    session.seek(timeInMilliseconds(Math.min(end, Math.max(0, frame)), session))
  const step = (direction: number) =>
    seekFrame(direction > 0 ? Math.floor(current) + 1 : Math.ceil(current) - 1)
  function scrub(timeMs: number) {
    if (!fps) session.seek(timeMs)
    else seekFrame(Math.round((timeMs * fps) / 1000))
  }
  const playhead = (
    <div className="ae-playhead" style={position(localTimeMs, durationMs)} />
  )
  const targetsToShow = poseEditing
    ? snapshot.selectedBone
      ? [{kind: 'bone' as const, boneName: snapshot.selectedBone}]
      : []
    : targets(session, snapshot.selectedBone)
  const poseKeys = new Map<number, number>()
  if (poseEditing) {
    for (const sourceTime of session.sourcePoseKeyTimes)
      poseKeys.set(timeValue(sourceTime, fps), sourceTime)
    for (const channel of snapshot.channels) {
      if (channel.kind !== 'bone') continue
      for (const key of channel.keys)
        poseKeys.set(timeValue(key.timeMs, fps), key.timeMs)
    }
  }
  return (
    <section
      className={['cs-action-panel', className].filter(Boolean).join(' ')}
      aria-label={t('pg.actionEditor.timeline')}
    >
      <header>
        <h2>
          {t('pg.actionEditor.title')}
          {session.name && ` · ${session.name}`}
        </h2>
        <div className="ae-controls">
          {fps && (
            <button
              type="button"
              aria-label={t('pg.actionEditor.previousFrame')}
              disabled={locked || current <= 0}
              onClick={() => step(-1)}
            >
              ‹
            </button>
          )}
          <label>
            {localTimeLabel}
            <NumberField
              label={localTimeLabel}
              value={current}
              min={0}
              max={end}
              disabled={locked}
              onChange={seekFrame}
            />
          </label>
          {fps && (
            <button
              type="button"
              aria-label={t('pg.actionEditor.nextFrame')}
              disabled={locked || current >= end}
              onClick={() => step(1)}
            >
              ›
            </button>
          )}
        </div>
      </header>
      <div className="ae-track">
        <span>{localTimeLabel}</span>
        <div className="ae-lane ae-ruler">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span
              className="ae-tick"
              key={fraction}
              style={position(durationMs * fraction, durationMs)}
            >
              {Number((end * fraction).toFixed(fps ? 1 : 2))}
            </span>
          ))}
          {playhead}
          <input
            type="range"
            aria-label={t('pg.actionEditor.scrub')}
            aria-valuetext={`${localTimeLabel} ${current}`}
            min={0}
            max={durationMs}
            step="any"
            value={localTimeMs}
            disabled={locked}
            onChange={(event) => scrub(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => {
              if (!fps || !['ArrowLeft', 'ArrowRight'].includes(event.key))
                return
              event.preventDefault()
              step(event.key === 'ArrowRight' ? 1 : -1)
            }}
          />
        </div>
      </div>
      {poseEditing && (
        <div className="ae-track">
          <span>{t('pg.actionEditor.poseKeys')}</span>
          <div className="ae-lane">
            <div
              className="ae-clip-window"
              style={{
                left: `${(100 * sourceInMs) / durationMs}%`,
                width: `${(100 * (sourceOutMs - sourceInMs)) / durationMs}%`,
              }}
            />
            {playhead}
            {[...poseKeys]
              .sort(([left], [right]) => left - right)
              .map(([time, timeMs]) => {
                const selected = time === current
                const label = t(
                  fps ? 'pg.actionEditor.keyAtFrame' : 'pg.actionEditor.keyAt',
                  {channel: t('pg.actionEditor.pose'), time},
                )
                return (
                  <button
                    key={time}
                    className="ae-key"
                    type="button"
                    style={position(timeMs, durationMs)}
                    aria-label={label}
                    aria-pressed={selected}
                    disabled={locked}
                    title={label}
                    onClick={() => session.seek(timeMs)}
                  >
                    {selected ? '◆' : '◇'}
                  </button>
                )
              })}
          </div>
        </div>
      )}
      {!poseEditing &&
        !targetsToShow.length &&
        session.boneNames.length > 0 && (
          <p>{t('pg.actionEditor.chooseBoneTrack')}</p>
        )}
      {targetsToShow.map((target) => {
        const row = channelId(target)
        const channel = session.getChannel(target)
        const label = channelLabel(t, target)
        return (
          <div className="ae-track" key={row}>
            <span className="ae-track-name" title={label}>
              {label.replace(/^mixamorig[:_]?/i, '') || label}
            </span>
            <div className="ae-lane">
              <div
                className="ae-clip-window"
                style={{
                  left: `${(100 * sourceInMs) / durationMs}%`,
                  width: `${(100 * (sourceOutMs - sourceInMs)) / durationMs}%`,
                }}
              />
              {playhead}
              {channel?.keys.map((key) => {
                const selected =
                  selectedKey?.keyId === key.id &&
                  channelId(selectedKey) === row
                const keyLabel = t(
                  fps ? 'pg.actionEditor.keyAtFrame' : 'pg.actionEditor.keyAt',
                  {
                    channel: label,
                    time: fps
                      ? timeValue(key.timeMs, fps)
                      : seconds(key.timeMs),
                  },
                )
                return (
                  <button
                    className="ae-key"
                    key={key.id}
                    type="button"
                    style={position(key.timeMs, session.durationMs)}
                    aria-label={keyLabel}
                    aria-pressed={selected}
                    disabled={locked}
                    title={keyLabel}
                    onClick={() =>
                      session.selectKey({...target, keyId: key.id})
                    }
                  >
                    {selected ? '◆' : '◇'}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}

type NumberFieldProps = {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  required?: boolean
  disabled?: boolean
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
}: NumberFieldProps) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      type="number"
      aria-label={label}
      step="any"
      min={min}
      max={max}
      required={required}
      disabled={disabled}
      value={text ?? value}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber
        setText(event.currentTarget.value)
        if (
          Number.isFinite(next) &&
          next >= (min ?? -Infinity) &&
          next <= (max ?? Infinity)
        )
          onChange(next)
      }}
      onBlur={() => setText(null)}
    />
  )
}

function VectorFields({
  label,
  value,
  onChange,
}: Pick<NumberFieldProps, 'label'> & {
  value: ActionEditorXYZ
  onChange: (value: ActionEditorXYZ) => void
}) {
  const t = useT()
  return (
    <div className="ae-vector">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <label key={axis}>
          {axis.toUpperCase()}
          <NumberField
            label={t('pg.actionEditor.component', {
              group: label,
              axis: axis.toUpperCase(),
            })}
            value={Number(value[axis].toFixed(6))}
            onChange={(next) =>
              onChange({x: value.x, y: value.y, z: value.z, [axis]: next})
            }
          />
        </label>
      ))}
    </div>
  )
}

function RotationFields({
  label,
  value,
  onChange,
}: {
  label: string
  value: ActionEditorQuaternion
  onChange: (value: ActionEditorQuaternion) => void
}) {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(value.x, value.y, value.z, value.w),
    'XYZ',
  )
  return (
    <VectorFields
      label={label}
      value={euler}
      onChange={({x, y, z}) => {
        const quaternion = new Quaternion().setFromEuler(
          new Euler(x, y, z, 'XYZ'),
        )
        onChange(quaternion)
      }}
    />
  )
}

function KeyControls({
  session,
  selected,
  timeMs,
  canDelete,
}: {
  session: ActionEditorSession
  selected: ActionEditorKeyRef
  timeMs: number
  canDelete: boolean
}) {
  const t = useT()
  const fps = session.framesPerSecond
  const [time, setTime] = useState(timeValue(timeMs, fps))
  const [error, setError] = useState(false)
  const keyTimeLabel = t(
    fps ? 'pg.actionEditor.keyFrame' : 'pg.actionEditor.keyTime',
  )
  return (
    <form
      className="ae-controls"
      onSubmit={(event) => {
        event.preventDefault()
        setError(!session.moveKey(selected, timeInMilliseconds(time, session)))
      }}
    >
      <label>
        {keyTimeLabel}
        <NumberField
          label={keyTimeLabel}
          value={time}
          onChange={setTime}
          required
        />
      </label>
      <button type="submit">{t('pg.actionEditor.moveKey')}</button>
      <button
        type="button"
        disabled={!canDelete}
        title={canDelete ? undefined : t('pg.actionEditor.keepKey')}
        onClick={() => session.deleteKey(selected)}
      >
        {t('pg.actionEditor.deleteKey')}
      </button>
      {error && <p role="alert">{t('pg.actionEditor.moveError')}</p>}
    </form>
  )
}

export function ActionEditorInspector({
  session,
  className,
  onRequestBoneGizmo,
  viewportControls,
}: ActionEditorProps) {
  const t = useT()
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [scope, setScope] = useState<ActionEditorScope>('strip')
  const [confirming, setConfirming] = useState(false)
  const [applyError, setApplyError] = useState(false)
  const [boneDetails, setBoneDetails] = useState(false)
  useEffect(() => {
    setScope('strip')
    setConfirming(false)
    setApplyError(false)
    setBoneDetails(false)
  }, [session])
  if (snapshot.status !== 'open') return null
  const {selectedBone, selectedKey, localTimeMs, entry, values} = snapshot
  const hasPreview = hasActionEditorPreview(snapshot.preview)
  const showBoneDetails = !onRequestBoneGizmo || boneDetails
  const boneTargets = targets(session, selectedBone).flatMap((channel) =>
    channel.kind === 'bone' ? [channel.boneName] : [],
  )
  const boneNames = [...new Set([...session.boneNames, ...boneTargets])]
  const selectedChannel = selectedKey && session.getChannel(selectedKey)
  const key =
    selectedKey &&
    selectedChannel &&
    selectedChannel.keys.find((item) => item.id === selectedKey.keyId)
  const sceneLabel = session.framesPerSecond
    ? t('pg.actionEditor.sceneFrame', {
        frame: Math.round((entry.sceneTimeMs * session.framesPerSecond) / 1000),
      })
    : t('pg.actionEditor.sceneTime', {time: seconds(entry.sceneTimeMs)})

  function cancel() {
    if (snapshot.isDirty || hasPreview) setConfirming(true)
    else session.cancel()
  }

  function keyButton(target: ActionEditorChannelRef, canRecord: boolean) {
    const channel = session.getChannel(target)
    const atKey = channel?.keys.some((item) =>
      sameKeyTime(item.timeMs, localTimeMs),
    )
    const label = t(
      atKey ? 'pg.actionEditor.updateKey' : 'pg.actionEditor.addKey',
      {
        channel: channelLabel(t, target),
      },
    )
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={!canRecord}
        onClick={() => session.recordKey(target)}
      >
        {atKey ? '◆' : '◇'}
      </button>
    )
  }

  if (viewportControls) {
    return (
      <section
        className={className}
        aria-label={t('pg.actionEditor.title')}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          viewportControls.cancel()
        }}
      >
        <h2>{t('pg.actionEditor.editInViewport')}</h2>
        <p role="status">{t('pg.actionEditor.viewportPending')}</p>
        <footer>
          <button type="button" onClick={viewportControls.cancel}>
            {t('pg.actionEditor.discardPreview')}
          </button>
          <button
            type="button"
            className="ae-apply"
            onClick={viewportControls.record}
          >
            {t('pg.actionEditor.recordCurrentPose')}
          </button>
        </footer>
      </section>
    )
  }

  return (
    <section
      className={className}
      aria-label={t('pg.actionEditor.title')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (confirming) setConfirming(false)
        else cancel()
      }}
    >
      <header>
        <h2>{t('pg.actionEditor.title')}</h2>
        <span>
          {sceneLabel} ·{' '}
          {t('pg.actionEditor.loop', {
            iteration: entry.iteration,
            repeat: entry.repeat,
          })}
        </span>
      </header>
      {onRequestBoneGizmo && (
        <div className="ae-pose-tools">
          <button
            type="button"
            className="ae-apply"
            onClick={() => onRequestBoneGizmo()}
          >
            {t('pg.actionEditor.editInViewport')}
          </button>
          <button
            type="button"
            aria-expanded={boneDetails}
            onClick={() => {
              if (boneDetails) session.selectBone(null)
              setBoneDetails(!boneDetails)
            }}
          >
            {t('pg.actionEditor.boneDetails')}
          </button>
        </div>
      )}
      {selectedKey && selectedChannel && key && (
        <KeyControls
          key={`${channelId(selectedKey)}:${key.id}:${key.timeMs}`}
          session={session}
          selected={selectedKey}
          timeMs={key.timeMs}
          canDelete={session.canDeleteKey(selectedKey)}
        />
      )}
      {session.objectChannels.map((kind) => {
        const label = channelLabel(t, {kind})
        const value = values.object[kind]
        return (
          <fieldset className="ae-group" key={kind}>
            <legend>
              {label} {keyButton({kind}, value !== undefined)}
            </legend>
            {kind === 'quaternion'
              ? values.object.quaternion && (
                  <RotationFields
                    label={label}
                    value={values.object.quaternion}
                    onChange={(next) => session.setObjectPreview(kind, next)}
                  />
                )
              : value && (
                  <VectorFields
                    label={label}
                    value={value}
                    onChange={(next) => session.setObjectPreview(kind, next)}
                  />
                )}
          </fieldset>
        )
      })}
      {showBoneDetails && boneNames.length > 0 && (
        <label>
          {t('pg.actionEditor.bone')}
          <select
            value={selectedBone ?? ''}
            onChange={(event) =>
              session.selectBone(event.currentTarget.value || null)
            }
          >
            <option value="">{t('pg.actionEditor.chooseBone')}</option>
            {boneNames.map((boneName) => (
              <option key={boneName} value={boneName}>
                {boneName}
              </option>
            ))}
          </select>
        </label>
      )}
      {showBoneDetails &&
        selectedBone &&
        (() => {
          const value = Object.prototype.hasOwnProperty.call(
            values.bones,
            selectedBone,
          )
            ? values.bones[selectedBone]
            : undefined
          return (
            <fieldset className="ae-group" key={selectedBone}>
              <legend>
                {selectedBone}{' '}
                {keyButton(
                  {kind: 'bone', boneName: selectedBone},
                  value !== undefined,
                )}
              </legend>
              {value && (
                <>
                  <label>{t('pg.actionEditor.position')}</label>
                  <VectorFields
                    label={t('pg.actionEditor.position')}
                    value={value.position}
                    onChange={(next) =>
                      session.setBonePreview(selectedBone, {
                        ...value,
                        position: next,
                      })
                    }
                  />
                  <label>{t('pg.actionEditor.quaternion')}</label>
                  <RotationFields
                    label={t('pg.actionEditor.quaternion')}
                    value={value.quaternion}
                    onChange={(next) =>
                      session.setBonePreview(selectedBone, {
                        ...value,
                        quaternion: next,
                      })
                    }
                  />
                  <label>{t('pg.actionEditor.scale')}</label>
                  <VectorFields
                    label={t('pg.actionEditor.scale')}
                    value={value.scale}
                    onChange={(next) =>
                      session.setBonePreview(selectedBone, {
                        ...value,
                        scale: next,
                      })
                    }
                  />
                </>
              )}
            </fieldset>
          )
        })()}
      {snapshot.discardedPreview && (
        <p role="status">{t('pg.actionEditor.previewDiscarded')}</p>
      )}
      {hasPreview && (
        <>
          <p role="status">{t('pg.actionEditor.previewPending')}</p>
          {Object.keys(snapshot.preview.bones).length > 1 && (
            <button
              type="button"
              onClick={() => {
                for (const boneName of Object.keys(snapshot.preview.bones))
                  session.recordKey({kind: 'bone', boneName})
              }}
            >
              {t('pg.actionEditor.recordPose')}
            </button>
          )}
          <button type="button" onClick={session.resetPreview}>
            {t('pg.actionEditor.clearPreview')}
          </button>
        </>
      )}
      {applyError && <p role="alert">{t('pg.actionEditor.applyError')}</p>}
      {confirming ? (
        <footer>
          <p role="status">{t('pg.actionEditor.confirmDiscard')}</p>
          <button type="button" onClick={session.cancel}>
            {t('pg.actionEditor.discard')}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            {t('pg.actionEditor.keepEditing')}
          </button>
        </footer>
      ) : (
        <footer>
          {session.canApplyToAll && (
            <label>
              {t('pg.actionEditor.scope')}
              <select
                value={scope}
                onChange={(event) =>
                  setScope(
                    event.currentTarget.value === 'all' ? 'all' : 'strip',
                  )
                }
              >
                <option value="strip">{t('pg.actionEditor.thisStrip')}</option>
                <option value="all">
                  {t('pg.actionEditor.allStrips', {
                    count: session.referenceCount,
                  })}
                </option>
              </select>
            </label>
          )}
          <button type="button" onClick={cancel}>
            {t('pg.actionEditor.cancel')}
          </button>
          <button
            className="ae-apply"
            type="button"
            disabled={hasPreview}
            onClick={() => {
              try {
                session.apply(scope)
                setApplyError(false)
              } catch {
                setApplyError(true)
              }
            }}
          >
            {t('pg.actionEditor.apply')}
          </button>
        </footer>
      )}
    </section>
  )
}

export function ActionEditor({
  session,
  className,
  onRequestBoneGizmo,
}: ActionEditorProps) {
  return (
    <div className={['cs-action-panels', className].filter(Boolean).join(' ')}>
      <ActionEditorTimeline
        session={session}
        poseEditing={Boolean(onRequestBoneGizmo)}
      />
      <ActionEditorInspector
        session={session}
        onRequestBoneGizmo={onRequestBoneGizmo}
      />
    </div>
  )
}
