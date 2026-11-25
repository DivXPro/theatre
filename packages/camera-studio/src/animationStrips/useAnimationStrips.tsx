import {getStudioSync, onChange, val} from '@dreamerbird/core'
import type {ISheetObject} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/camera-studio'
import {useVal} from '@dreamerbird/react'
import {
  getSequenceEditorView,
  registerAdditionalSequenceRows,
  registerSequenceEditorView,
  type AdditionalSequenceRow,
} from '@dreamerbird/studio/camera-studio'
import {translate, useT} from '@dreamerbird/studio/i18n'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import type {Group, AnimationClip} from 'three'
import {
  ActionEditorInspector,
  ActionEditorTimeline,
  type ActionEditorProps,
} from '../actionEditor/ActionEditor'
import {createActionEditorSession} from '../actionEditor/session'
import type {ActionEditorSession} from '../actionEditor/session'
import type {ActionEditorValues} from '../actionEditor/keys'
import {AgentApiError} from '../agent/errors'
import {animationClipForModel} from '../assetLibrary/animationClipForModel'
import {createGLTFLoader} from '../assetLibrary/gltfLoader'
import {getLibrary, useLibraryEntries} from '../assetLibrary/library'
import {rigIdOf} from '../assetLibrary/rig'
import {prefetchLibPoses, resolveLibPoseBones} from '../poseMode/poseLibResolve'
import {collectLibPoseIdsForProps} from '../poseMode/poseTrack'
import {
  getPoseSession,
  requestPoseCancel,
  requestPoseExit,
  usePoseSession,
} from '../poseMode/poseSession'
import {resolveControlSpec} from '../poseMode/controlSpec'
import {
  readBoneTransform,
  readRootTransform,
  sampleObjectActions,
  sourceBoneKeyTimes,
  toBonePose,
} from './actionSampling'
import {
  AnimationStripHeader,
  AnimationStripObjectActions,
  AnimationStripToolbar,
  AnimationStripTrack,
} from './AnimationStripRow'
import {composePose} from './composer'
import {beginActionDraftPose} from './actionPose'
import {
  getAnimationStripSnapshot,
  registerAnimationStripExport,
} from './exportSession'
import type {AnimationStripSnapshot} from './exportSession'
import {
  editableActionFor,
  findAnimationStrip,
  hasSkeletalStripLayer,
  inlineObjectActionId,
  objectChannelsFor,
  parseAnimationTracks,
  sourceTimeAt,
  stripEndMs,
  stripsInRange,
} from './model'
import type {AnimationStrip} from './model'
import {hasRootTravel} from './rootTravel'
import {applyAnimationStripFrame, createStripSampler} from './sampler'
import {commitAnimationAction} from './storage'
import type {AnimationTracksObject} from './storage'
import {
  animationObjectAddressKey,
  registerAnimationStripActionOpener,
  selectAnimationStrip,
} from './stripSelection'
import {renderAnimationStripSidebar} from './AnimationStripSidebar'
import {validateCharacterPathForExport} from '../characterPaths'

type ClipResource =
  | {status: 'loading'; promise: Promise<AnimationClip>}
  | {status: 'ready'; clip: AnimationClip; name: string}
  | {status: 'error'; error: unknown}

function DockedActionTimeline({
  placementKey,
  session,
  poseEditing,
}: Pick<ActionEditorProps, 'session' | 'poseEditing'> & {
  placementKey: string
}) {
  const pose = usePoseSession()
  return (
    <ActionEditorTimeline
      session={session}
      poseEditing={poseEditing}
      locked={pose?.key === placementKey && pose.target === 'draft'}
    />
  )
}

function DockedActionInspector({
  placementKey,
  ...props
}: ActionEditorProps & {placementKey: string}) {
  const pose = usePoseSession()
  return (
    <ActionEditorInspector
      {...props}
      viewportControls={
        pose?.key === placementKey && pose.target === 'draft'
          ? {record: () => requestPoseExit('save'), cancel: requestPoseCancel}
          : undefined
      }
    />
  )
}

function LegacyAnimation({
  object,
  rig,
}: {
  object: ISheetObject<any>
  rig: string | null
}) {
  const t = useT()
  const value = useVal(object.props.animation) as string
  const entries = useLibraryEntries('animation')
  const options = entries.filter(
    (entry) => entry.kind === 'animation' && entry.rig === rig,
  )
  const replacement = options.find(
    (entry) =>
      entry.kind === 'animation' &&
      entry.aliases?.some((alias) => alias.id === value),
  )
  return (
    <select
      aria-label={t('pg.strips.legacy')}
      value={value}
      onChange={(event) => {
        const assetId = event.currentTarget.value
        getStudioSync()?.transaction(({set}) =>
          set(object.props.animation, assetId),
        )
      }}
    >
      <option value="">{t('pg.strips.legacy')}</option>
      {value && !options.some((entry) => entry.id === value) && (
        <option value={value}>{replacement?.name ?? value}</option>
      )}
      {options.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  )
}

export function useAnimationStrips(
  object: AnimationTracksObject | undefined,
  instance: Group,
  libraryEntryId: string | undefined,
  invalidate: () => void,
  placementKey: string,
) {
  const config = useVal(object?.props.animationTracks) ?? ''
  const [statuses, setStatuses] = useState<
    ReadonlyMap<string, ClipResource['status']>
  >(() => new Map())
  const [rig, setRig] = useState<string | null>(null)
  const sampler = useMemo(() => createStripSampler(instance), [instance])
  const resources = useMemo(
    () => new Map<string, ClipResource>(),
    [sampler, object],
  )
  const state = useMemo(() => parseAnimationTracks(config), [config])
  const pathObject = object as ISheetObject<any> | undefined
  const pathBound = Boolean(useVal(pathObject?.props.characterPathId) as string)
  const pathOrient =
    (useVal(pathObject?.props.characterPathOrient) as boolean | undefined) ??
    true
  const previousSampler = useRef<typeof sampler | null>(null)
  const [editorError, setEditorError] = useState('')
  const editorRef = useRef<ActionEditorSession | null>(null)

  const modelRig = useMemo(() => {
    const instanceRig = rigIdOf(instance)
    return async () => {
      if (instanceRig === 'static') return null
      if (libraryEntryId) {
        const entry = await getLibrary().getEntry(libraryEntryId)
        if (entry?.kind === 'model') return entry.rig
      }
      return instanceRig
    }
  }, [instance, libraryEntryId])

  useEffect(() => {
    let mounted = true
    setRig(null)
    void modelRig().then(
      (rigId) => {
        if (mounted) setRig(rigId)
      },
      () => {
        if (mounted && sampler.hasBones) setRig(rigIdOf(instance))
      },
    )
    return () => {
      mounted = false
    }
  }, [modelRig, sampler, instance])

  const readState = () => {
    const latest = object ? val(object.props.animationTracks) : ''
    return latest === config ? state : parseAnimationTracks(latest)
  }

  const load = useMemo(() => {
    const report = () => {
      setStatuses(
        new Map([...resources].map(([id, entry]) => [id, entry.status])),
      )
      invalidate()
    }
    return (assetId: string): Promise<AnimationClip> => {
      const previous = resources.get(assetId)
      if (previous?.status === 'ready') return Promise.resolve(previous.clip)
      if (previous?.status === 'loading') return previous.promise
      if (previous?.status === 'error') return Promise.reject(previous.error)
      const library = getLibrary()
      let name = ''
      const promise = (async () => {
        const [entry, targetRig] = await Promise.all([
          library.getEntry(assetId),
          modelRig(),
        ])
        if (
          entry?.kind !== 'animation' ||
          targetRig === null ||
          entry.rig !== targetRig
        ) {
          throw new Error('Animation asset is missing or incompatible')
        }
        const url = await library.getBlobUrl(entry.blobId)
        const gltf = await createGLTFLoader().loadAsync(url)
        const clip = animationClipForModel(gltf, instance)
        if (!clip) throw new Error('Animation asset contains no clip')
        name = entry.name
        sampler.prepare(clip)
        return clip
      })()
      resources.set(assetId, {status: 'loading', promise})
      report()
      void promise.then(
        (clip) => {
          const current = resources.get(assetId)
          if (current?.status !== 'loading' || current.promise !== promise)
            return
          resources.set(assetId, {status: 'ready', clip, name})
          report()
        },
        (error: unknown) => {
          const current = resources.get(assetId)
          if (current?.status !== 'loading' || current.promise !== promise)
            return
          resources.set(assetId, {status: 'error', error})
          report()
        },
      )
      return promise
    }
  }, [invalidate, instance, modelRig, resources, sampler])

  useEffect(() => () => sampler.dispose(), [sampler])
  useEffect(() => () => resources.clear(), [resources])
  useEffect(
    () => () => {
      const editor = editorRef.current
      editorRef.current = null
      editor?.cancel()
    },
    [object],
  )
  useEffect(() => {
    const active = hasSkeletalStripLayer(state)
    if (!active && previousSampler.current === sampler) {
      sampler.resetBase()
    }
    previousSampler.current = active ? sampler : null
  }, [state, sampler])

  useEffect(() => {
    if (!object || state.kind === 'legacy') return
    invalidate()
    const stop = onChange(object.sheet.sequence.pointer.position, () =>
      invalidate(),
    )
    if (state.kind !== 'tracks') return stop
    const ids = new Set(
      state.document.tracks.flatMap((track) =>
        track.kind === 'object'
          ? []
          : track.strips.map((strip) => strip.assetId),
      ),
    )
    for (const assetId of ids) void load(assetId).catch(() => {})
    const unsubscribe = getLibrary().subscribe(() => {
      for (const assetId of ids) {
        resources.delete(assetId)
        void load(assetId).catch(() => {})
      }
    })
    return () => {
      stop()
      unsubscribe()
    }
  }, [object, state, invalidate, load, resources])

  function openAction(strip: AnimationStrip) {
    if (!object || editorRef.current || getPoseSession()) return
    const sequence = object.sheet.sequence
    if (getSequenceEditorView(sequence)) return
    const latest = readState()
    if (latest.kind !== 'tracks') return
    const found = findAnimationStrip(latest.document, strip.id)
    if (!found) return
    const isObject = found.track.kind === 'object'
    const resource = resources.get(strip.assetId)
    const clip = resource?.status === 'ready' ? resource.clip : undefined
    if (!isObject && !clip) {
      setEditorError(
        translate(
          resource?.status === 'error'
            ? 'pg.strips.assetError'
            : 'pg.strips.loading',
        ),
      )
      return
    }
    setEditorError('')
    const sceneTimeMs = sequence.position * 1000
    const fps = privateAPI(sequence).subUnitsPerUnit
    const current = editableActionFor(latest.document, found.strip)
    const durationMs = clip
      ? clip.duration * 1000
      : strip.sourceDurationMs ?? strip.sourceOutMs
    const values = object.value as ISheetObject<any>['value']
    const root = readRootTransform(values)
    const onFrameGrid = (timeMs: number) => {
      const frameMs = (Math.round((timeMs * fps) / 1000) * 1000) / fps
      return Math.abs(frameMs - timeMs) < 0.001
        ? Math.min(durationMs, frameMs)
        : timeMs
    }
    const sample = (localTimeMs: number): ActionEditorValues => {
      if (!clip) return {object: root, bones: {}}
      const sampled = composePose(sampler.bindPose, [
        {pose: sampler.sample(clip, localTimeMs / 1000), weight: 1},
      ])
      return {
        object: {},
        bones: Object.fromEntries(
          [...sampled].map(([name, transform]) => [
            name,
            readBoneTransform(transform),
          ]),
        ),
      }
    }
    const poseEditing = Boolean(clip && resolveControlSpec(instance))
    const session = createActionEditorSession({
      strip: found.strip,
      durationMs,
      sceneTimeMs,
      sourceTimeAt: (timeMs) => {
        const source = sourceTimeAt(found.strip, timeMs)
        return source == null ? source : onFrameGrid(source)
      },
      channels: current?.channels ?? [],
      objectChannels: isObject ? objectChannelsFor(found.strip) : [],
      boneNames: isObject ? [] : [...sampler.bindPose.keys()],
      sample,
      seedBoneKeys: clip
        ? (boneName) =>
            sourceBoneKeyTimes(clip, boneName)
              .filter((timeMs) => timeMs <= durationMs)
              .map((timeMs) => ({
                timeMs: onFrameGrid(timeMs),
                value: sample(timeMs).bones[boneName]!,
              }))
        : undefined,
      name: isObject
        ? translate('pg.strips.objectAction')
        : resource?.status === 'ready'
          ? resource.name || resource.clip.name
          : undefined,
      framesPerSecond: fps,
      sourcePoseKeyTimes: clip?.tracks.flatMap((track) =>
        Array.from(track.times, (seconds) => onFrameGrid(seconds * 1000)),
      ),
      referenceCount: current
        ? latest.document.tracks.reduce(
            (count, track) =>
              count +
              track.strips.filter(
                (candidate) => candidate.actionId === current.id,
              ).length,
            0,
          )
        : 1,
      onApply: (commit) =>
        commitAnimationAction(object, found.strip, commit, durationMs),
      onClose: () => {
        const pose = getPoseSession()
        if (pose?.key === placementKey && pose.target === 'draft')
          requestPoseCancel()
        sequence.position = sceneTimeMs / 1000
        if (editorRef.current === session) {
          const current = readState()
          if (
            current.kind === 'tracks' &&
            findAnimationStrip(current.document, strip.id)
          ) {
            const studio = getStudioSync()
            if (studio && !studio.selection.includes(object))
              studio.setSelection([object])
            selectAnimationStrip(object.address, strip.id)
          }
        }
        editorRef.current = null
        unsubscribe()
        closeView?.()
        invalidate()
      },
    })
    const closeView = registerSequenceEditorView(sequence, {
      timeline: (
        <DockedActionTimeline
          session={session}
          placementKey={placementKey}
          poseEditing={poseEditing}
        />
      ),
      sidebar: (
        <DockedActionInspector
          session={session}
          placementKey={placementKey}
          onRequestBoneGizmo={
            poseEditing
              ? () =>
                  beginActionDraftPose(
                    placementKey,
                    session,
                    sampler,
                    invalidate,
                  )
              : undefined
          }
        />
      ),
    })
    if (!closeView) return
    sequence.pause()
    editorRef.current = session
    const unsubscribe = session.subscribe(invalidate)
    invalidate()
  }

  const openActionRef = useRef(openAction)
  openActionRef.current = openAction
  useEffect(() => {
    if (!object) return
    return registerAnimationStripActionOpener(
      animationObjectAddressKey(object.address),
      (strip) => openActionRef.current(strip),
    )
  }, [object])

  const readPathConflict = (
    orient: boolean,
    legacyClip?: AnimationClip | null,
  ): string | undefined => {
    const latest = readState()
    if (latest.kind === 'invalid') return translate('pg.strips.unreadable')
    const tracks = latest.kind === 'tracks' ? latest.document.tracks : []
    for (const track of tracks) {
      for (const strip of track.strips) {
        if (track.kind === 'object') {
          const channels = objectChannelsFor(strip)
          if (
            channels.includes('position') ||
            (orient && channels.includes('quaternion'))
          ) {
            return translate('pg.strips.pathObjectConflict', {
              start: (strip.startMs / 1000).toFixed(2),
              end: (stripEndMs(strip) / 1000).toFixed(2),
            })
          }
          continue
        }
        const resource = resources.get(strip.assetId)
        if (!resource || resource.status !== 'ready')
          return translate('pg.strips.pathCheckSource')
        if (
          hasRootTravel(
            instance,
            resource.clip,
            strip.sourceInMs / 1000,
            strip.sourceOutMs / 1000,
          )
        ) {
          return translate('pg.strips.pathRootConflict', {
            name: resource.clip.name || strip.assetId,
          })
        }
      }
    }
    if (
      !hasSkeletalStripLayer(latest) &&
      legacyClip &&
      hasRootTravel(instance, legacyClip)
    ) {
      return translate('pg.strips.pathRootConflict', {
        name: legacyClip.name,
      })
    }
    return undefined
  }

  useEffect(() => {
    if (!object) return
    return registerAdditionalSequenceRows(object, () => {
      const latest = parseAnimationTracks(val(object.props.animationTracks))
      const actor = object as ISheetObject<any>
      const legacy =
        !hasSkeletalStripLayer(latest) && Boolean(val(actor.props.animation))
      const conflict = pathBound ? readPathConflict(pathOrient) : ''
      const status = editorError || conflict
      const rows: AdditionalSequenceRow[] = [
        {
          id: 'animation-track-tools',
          countsAsTrack: legacy || latest.kind === 'invalid',
          isHeaderVisible: () =>
            legacy || latest.kind === 'invalid' || Boolean(status),
          renderObjectHeader: () => (
            <AnimationStripObjectActions
              object={object}
              canAddBone={rig !== null}
            />
          ),
          renderSidebar: () => renderAnimationStripSidebar(object, latest),
          renderHeader: () => (
            <AnimationStripToolbar
              object={object}
              legacyControl={
                legacy ? (
                  <LegacyAnimation object={actor} rig={rig} />
                ) : undefined
              }
              status={status}
            />
          ),
          renderTrack: () => (
            <>
              {editorError && <span role="alert">{editorError}</span>}
              {conflict && <span role="alert">{conflict}</span>}
            </>
          ),
        },
      ]
      if (latest.kind !== 'tracks') return rows
      rows.push(
        ...latest.document.tracks.map(
          (track): AdditionalSequenceRow => ({
            id: track.id,
            renderHeader: () => (
              <AnimationStripHeader
                object={object}
                rig={rig}
                trackId={track.id}
                trackKind={track.kind}
              />
            ),
            renderTrack: (layout) => (
              <AnimationStripTrack
                object={object}
                layout={layout}
                statuses={statuses}
                trackId={track.id}
                trackKind={track.kind}
                onEditAction={openAction}
              />
            ),
          }),
        ),
      )
      return rows
    })
  }, [
    object,
    rig,
    statuses,
    editorError,
    state,
    instance,
    pathBound,
    pathOrient,
  ])

  useEffect(() => {
    if (!object) return
    return registerAnimationStripExport(
      object,
      async (startMs, endMs, signal) => {
        const snapshotState = parseAnimationTracks(
          val(object.props.animationTracks),
        )
        const clips = new Map<string, AnimationClip>()
        const fail = (message: string, assetId?: string) =>
          new AgentApiError(
            'RESOURCE_LOAD_FAILED',
            `${object.address.objectKey}: ${message}`,
            {
              details: {objectKey: object.address.objectKey, assetId},
            },
          )
        if (snapshotState.kind === 'invalid')
          throw fail('Unreadable animation tracks')
        const pathError = validateCharacterPathForExport(
          object.sheet,
          object.value,
        )
        if (pathError) throw fail(pathError.message)
        const snapshot: AnimationStripSnapshot = {state: snapshotState, clips}
        const needed =
          snapshotState.kind === 'tracks'
            ? stripsInRange(snapshotState.document, startMs, endMs).filter(
                (strip) => strip.assetId !== inlineObjectActionId,
              )
            : []
        const assets = new Set(needed.map((strip) => strip.assetId))
        const poseIds = collectLibPoseIdsForProps(object, [
          'pose',
          'defaultPose',
          'gestureL',
          'gestureR',
        ])
        await Promise.all([
          ...[...assets].map(async (assetId) => {
            try {
              const clip = await load(assetId)
              if (
                needed.some(
                  (strip) =>
                    strip.assetId === assetId &&
                    strip.sourceOutMs > clip.duration * 1000 + 0.001,
                )
              ) {
                throw new Error('Animation source range exceeds clip duration')
              }
              if (!signal.aborted) clips.set(assetId, clip)
            } catch {
              throw fail(`Animation asset unavailable: ${assetId}`, assetId)
            }
          }),
          prefetchLibPoses(poseIds, invalidate).then(() => {
            if (signal.aborted) return
            for (const id of poseIds) {
              if (!resolveLibPoseBones(id))
                throw fail(`Pose asset unavailable: ${id}`, id)
            }
          }),
        ])
        return snapshot
      },
    )
  }, [object, load, invalidate])

  return {
    state,
    pathConflict: readPathConflict,
    enterActionPose() {
      const action = editorRef.current
      if (!action?.boneNames.length) return false
      return beginActionDraftPose(placementKey, action, sampler, invalidate)
    },
    sampleObjectAt(timeMs: number, exporting: boolean) {
      if (!exporting && editorRef.current?.objectChannels.length) {
        const editor = editorRef.current
        const values = editor.getSnapshot().values.object
        return {
          position: editor.objectChannels.includes('position')
            ? values.position
            : undefined,
          quaternion: editor.objectChannels.includes('quaternion')
            ? values.quaternion
            : undefined,
          scale: editor.objectChannels.includes('scale')
            ? values.scale
            : undefined,
        }
      }
      const snapshot =
        exporting && object ? getAnimationStripSnapshot(object) : undefined
      return sampleObjectActions(snapshot?.state ?? readState(), timeMs)
    },
    previewBones() {
      const action = editorRef.current
      if (!action?.boneNames.length) return false
      sampler.applyPose(toBonePose(action.getSnapshot().values.bones))
      return true
    },
    hasLayer() {
      return hasSkeletalStripLayer(readState())
    },
    applyAt(
      timeMs: number,
      exporting: boolean,
      applyBase: () => void,
      applyOverlays?: () => void,
    ) {
      const snapshot =
        exporting && object ? getAnimationStripSnapshot(object) : undefined
      const frameState = snapshot?.state ?? readState()
      if (!hasSkeletalStripLayer(frameState)) return false
      applyAnimationStripFrame(
        sampler,
        frameState,
        (assetId) => {
          if (snapshot) return snapshot.clips.get(assetId)
          const resource = resources.get(assetId)
          return resource?.status === 'ready' ? resource.clip : undefined
        },
        timeMs,
        applyBase,
        applyOverlays,
      )
      return true
    },
  }
}
