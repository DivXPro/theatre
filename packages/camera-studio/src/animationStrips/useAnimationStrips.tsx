import {onChange, val} from '@dreamerbird/core'
import {useVal} from '@dreamerbird/react'
import {registerAdditionalSequenceRow} from '@dreamerbird/studio/panels/SequenceEditorPanel/additionalRows'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import type {Group, AnimationClip} from 'three'
import {AgentApiError} from '../agent/errors'
import {createGLTFLoader} from '../assetLibrary/gltfLoader'
import {getLibrary} from '../assetLibrary/library'
import {rigIdOf} from '../assetLibrary/rig'
import {prefetchLibPoses, resolveLibPoseBones} from '../poseMode/poseLibResolve'
import {collectLibPoseIdsForProps} from '../poseMode/poseTrack'
import {AnimationStripHeader, AnimationStripTrack} from './AnimationStripRow'
import {
  getAnimationStripSnapshot,
  registerAnimationStripExport,
} from './exportSession'
import type {AnimationStripSnapshot} from './exportSession'
import {parseAnimationTracks, stripsInRange} from './model'
import {applyAnimationStripFrame, createStripSampler} from './sampler'
import type {AnimationTracksObject} from './storage'

type ClipResource =
  | {status: 'loading'; promise: Promise<AnimationClip>}
  | {status: 'ready'; clip: AnimationClip}
  | {status: 'error'; error: unknown}

export function useAnimationStrips(
  object: AnimationTracksObject | undefined,
  instance: Group,
  libraryEntryId: string | undefined,
  invalidate: () => void,
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
  const previousSampler = useRef<typeof sampler | null>(null)

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
        const clip = gltf.animations[0]
        if (!clip) throw new Error('Animation asset contains no clip')
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
          resources.set(assetId, {status: 'ready', clip})
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
  }, [invalidate, modelRig, resources, sampler])

  useEffect(() => () => sampler.dispose(), [sampler])
  useEffect(() => () => resources.clear(), [resources])
  useEffect(() => {
    if (state.kind === 'legacy' && previousSampler.current === sampler) {
      sampler.resetBase()
    }
    previousSampler.current = state.kind === 'legacy' ? null : sampler
  }, [state.kind, sampler])

  useEffect(() => {
    if (!object || state.kind === 'legacy') return
    invalidate()
    const stop = onChange(object.sheet.sequence.pointer.position, () =>
      invalidate(),
    )
    if (state.kind !== 'tracks') return stop
    const ids = new Set(
      state.document.tracks[0]!.strips.map((strip) => strip.assetId),
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

  useEffect(() => {
    if (!object || (!sampler.hasBones && state.kind === 'legacy')) return
    return registerAdditionalSequenceRow(object, {
      id: 'animationTracks',
      hasContent: () =>
        parseAnimationTracks(val(object.props.animationTracks)).kind !==
        'legacy',
      renderHeader: () => <AnimationStripHeader object={object} rig={rig} />,
      renderTrack: (layout) => (
        <AnimationStripTrack
          object={object}
          layout={layout}
          statuses={statuses}
        />
      ),
    })
  }, [object, rig, sampler, state.kind, statuses])

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
        const snapshot: AnimationStripSnapshot = {state: snapshotState, clips}
        if (snapshotState.kind === 'legacy') return snapshot
        const needed = stripsInRange(snapshotState.document, startMs, endMs)
        const assets = new Set(needed.map((strip) => strip.assetId))
        const poseIds = collectLibPoseIdsForProps(object, [
          'pose',
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
    hasLayer() {
      return readState().kind !== 'legacy'
    },
    applyAt(timeMs: number, exporting: boolean, applyBase: () => void) {
      const snapshot =
        exporting && object ? getAnimationStripSnapshot(object) : undefined
      const frameState = snapshot?.state ?? readState()
      if (frameState.kind === 'legacy') return false
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
      )
      return true
    },
  }
}
