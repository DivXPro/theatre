import {val} from '@dreamerbird/core'
import {
  AnimationStripOverlapError,
  AnimationStripRangeError,
  findAnimationStrip,
  parseAnimationTracks,
} from '../../animationStrips/model'
import type {
  AnimationStrip,
  AnimationStripTiming,
  AnimationTrack,
  AnimationTrackKind,
  ObjectAnimationChannel,
} from '../../animationStrips/model'
import {
  addAnimationTrack,
  commitAnimationStripTiming,
  insertAnimationStrip,
  insertObjectAnimationStrip,
  moveAnimationStripToTrack,
  removeAnimationStrip,
  removeAnimationTrack,
} from '../../animationStrips/storage'
import type {AnimationTracksObject} from '../../animationStrips/storage'
import {readAnimationDuration} from '../../animationStrips/assetDuration'
import type {AnimationEntry} from '../../assetLibrary/types'
import {AgentApiError} from '../errors'
import {resolveSceneSheetObject} from '../objectResolver'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'
import {resolveModelRig} from './animations'

export type AnimationStripsApi = {
  list(args: {objectId: string}): Promise<{tracks: AnimationTrack[]}>
  createTrack(args: {
    objectId: string
    kind: AnimationTrackKind
    expectedRevision?: number
  }): Promise<{revision: number; trackId: string}>
  removeTrack(args: {
    objectId: string
    trackId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  insert(
    args: AnimationStripTiming & {
      objectId: string
      trackId: string
      expectedRevision?: number
    } & (
        | {assetId: string; objectChannels?: never}
        | {assetId?: never; objectChannels: ObjectAnimationChannel[]}
      ),
  ): Promise<{revision: number; stripId: string}>
  updateTiming(
    args: AnimationStripTiming & {
      objectId: string
      stripId: string
      expectedRevision?: number
    },
  ): Promise<{revision: number}>
  moveToTrack(args: {
    objectId: string
    stripId: string
    trackId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  remove(args: {
    objectId: string
    stripId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
}

const string = {type: 'string'}
const number = {type: 'number'}
const kinds = ['bone', 'object'] as const
const channels = ['position', 'quaternion', 'scale'] as const
const channelSchema = {type: 'array', items: {type: 'string', enum: channels}}
const timingProperties = {
  startMs: {type: 'number', description: '场景时间，毫秒'},
  sourceInMs: {type: 'number', description: '素材入点，毫秒'},
  sourceOutMs: {type: 'number', description: '素材出点，毫秒'},
  repeat: {type: 'number', description: '正整数，默认为 1'},
}
const timingRequired = ['startMs', 'sourceInMs', 'sourceOutMs']
const kind = {type: 'string', enum: kinds}
const revisionOutput = {
  type: 'object',
  properties: {revision: number},
  required: ['revision'],
}
const errors = [
  'API_DISPOSED',
  'API_NOT_READY',
  'INVALID_ARGUMENT',
  'INVALID_ID_KIND',
  'INVALID_STATE',
  'OBJECT_NOT_FOUND',
  'ASSET_NOT_FOUND',
  'REVISION_CONFLICT',
  'SCENE_UNAVAILABLE',
  'RESOURCE_LOAD_FAILED',
] as const

function model(runtime: AgentRuntime, objectId: string): AnimationTracksObject {
  runtime.assertCurrent()
  const object = resolveSceneSheetObject(runtime.sheet, objectId, 'model')
  if (!object)
    throw new AgentApiError('INVALID_STATE', `模型未挂载: ${objectId}`)
  if (typeof object.value.animationTracks !== 'string') {
    throw new AgentApiError('INVALID_STATE', `模型不支持动画条: ${objectId}`)
  }
  return object as AnimationTracksObject
}

function tracks(object: AnimationTracksObject): AnimationTrack[] {
  const state = parseAnimationTracks(val(object.props.animationTracks))
  if (state.kind === 'invalid')
    throw new AgentApiError('INVALID_STATE', '动画轨道数据无法解析')
  return state.kind === 'tracks' ? state.document.tracks : []
}

function readTiming(args: Record<string, unknown>): AnimationStripTiming {
  const {repeat = 1} = args
  const startMs = requireFiniteNumber(args.startMs, 'startMs')
  const sourceInMs = requireFiniteNumber(args.sourceInMs, 'sourceInMs')
  const sourceOutMs = requireFiniteNumber(args.sourceOutMs, 'sourceOutMs')
  if (
    startMs < 0 ||
    sourceInMs < 0 ||
    sourceOutMs <= sourceInMs ||
    typeof repeat !== 'number' ||
    !Number.isSafeInteger(repeat) ||
    repeat < 1
  ) {
    throw new AgentApiError('INVALID_ARGUMENT', '动画条时间范围或重复次数无效')
  }
  return {startMs, sourceInMs, sourceOutMs, repeat}
}

function findTrack(object: AnimationTracksObject, trackId: string) {
  const track = tracks(object).find((entry) => entry.id === trackId)
  if (!track)
    throw new AgentApiError('INVALID_ARGUMENT', `动画轨道不存在: ${trackId}`)
  return track
}

function findStrip(object: AnimationTracksObject, stripId: string) {
  const found = findAnimationStrip(
    {version: 2, tracks: tracks(object)},
    stripId,
  )
  if (!found)
    throw new AgentApiError('INVALID_ARGUMENT', `动画条不存在: ${stripId}`)
  return found
}

async function animationAsset(runtime: AgentRuntime, assetId: string) {
  const entry = await runtime.library.getEntry(assetId)
  if (!entry)
    throw new AgentApiError('ASSET_NOT_FOUND', `资产不存在: ${assetId}`)
  if (entry.kind !== 'animation') {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `资产没有可用的动画时长: ${assetId}`,
    )
  }
  return entry
}

async function durationMs(runtime: AgentRuntime, asset: AnimationEntry) {
  try {
    return (await readAnimationDuration(asset, runtime.library)) * 1000
  } catch {
    throw new AgentApiError(
      'RESOURCE_LOAD_FAILED',
      `无法读取动画时长: ${asset.id}`,
    )
  }
}

async function stripDuration(runtime: AgentRuntime, strip: AnimationStrip) {
  return (
    strip.sourceDurationMs ??
    (await durationMs(runtime, await animationAsset(runtime, strip.assetId)))
  )
}

function currentStrip(object: AnimationTracksObject, original: AnimationStrip) {
  const found = findStrip(object, original.id)
  if (JSON.stringify(found.strip) !== JSON.stringify(original)) {
    throw new AgentApiError('INVALID_STATE', '动画条在编辑期间发生了变化')
  }
  return found
}

function editTimeline<T>(edit: () => T): T {
  try {
    return edit()
  } catch (error) {
    if (error instanceof AnimationStripOverlapError) {
      throw new AgentApiError('INVALID_STATE', error.message)
    }
    if (error instanceof AnimationStripRangeError) {
      throw new AgentApiError('INVALID_ARGUMENT', error.message)
    }
    throw error
  }
}

export function registerAnimationStripCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
) {
  registry.register({
    name: 'animationStrips.list',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {objectId: string},
      required: ['objectId'],
    },
    outputSchema: {
      type: 'object',
      required: ['tracks'],
      properties: {
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'strips'],
            properties: {
              id: string,
              kind,
              strips: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'assetId', ...timingRequired],
                  properties: {
                    id: string,
                    assetId: string,
                    ...timingProperties,
                    objectChannels: channelSchema,
                    sourceDurationMs: number,
                    actionId: string,
                  },
                },
              },
            },
          },
        },
      },
    },
    errorCodes: errors,
    validate: (value) => requireString(requireObject(value), 'objectId'),
    execute: async (objectId) => ({tracks: tracks(model(runtime, objectId))}),
  })

  type Apply = (object: AnimationTracksObject) => Record<string, string> | void
  function registerEdit(
    name: string,
    properties: Record<string, JsonSchema>,
    required: string[],
    prepare: (
      args: Record<string, unknown>,
      objectId: string,
      object: AnimationTracksObject,
    ) => Apply | Promise<Apply>,
    resultKey?: 'trackId' | 'stripId',
  ) {
    registry.register({
      name: `animationStrips.${name}`,
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      inputSchema: {
        type: 'object',
        properties: {objectId: string, expectedRevision: number, ...properties},
        required: ['objectId', ...required],
        additionalProperties: false,
      },
      outputSchema: resultKey
        ? {
            type: 'object',
            properties: {revision: number, [resultKey]: string},
            required: ['revision', resultKey],
          }
        : revisionOutput,
      errorCodes: errors,
      validate: (value) => {
        const args = requireObject(value)
        return {
          args,
          objectId: requireString(args, 'objectId'),
          expectedRevision:
            args.expectedRevision === undefined
              ? undefined
              : requireFiniteNumber(args.expectedRevision, 'expectedRevision'),
        }
      },
      execute: async ({args, objectId, expectedRevision}) => {
        const object = model(runtime, objectId)
        if (expectedRevision !== undefined)
          runtime.assertRevision(expectedRevision)
        const apply = await prepare(args, objectId, object)
        if (model(runtime, objectId) !== object) {
          throw new AgentApiError('INVALID_STATE', '模型在编辑期间发生了变化')
        }
        if (expectedRevision !== undefined)
          runtime.assertRevision(expectedRevision)
        const result = editTimeline(() => apply(object))
        return {...result, revision: await runtime.nextRevision()}
      },
    })
  }

  registerEdit(
    'createTrack',
    {kind},
    ['kind'],
    (args) => {
      const trackKind = args.kind
      if (trackKind !== 'bone' && trackKind !== 'object') {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'kind 必须为 bone 或 object',
        )
      }
      return (object) => {
        tracks(object)
        return {trackId: addAnimationTrack(object, trackKind)!}
      }
    },
    'trackId',
  )

  registerEdit('removeTrack', {trackId: string}, ['trackId'], (args) => {
    const trackId = requireString(args, 'trackId')
    return (object) => {
      findTrack(object, trackId)
      removeAnimationTrack(object, trackId)
    }
  })

  registerEdit(
    'insert',
    {
      trackId: string,
      assetId: string,
      objectChannels: channelSchema,
      ...timingProperties,
    },
    ['trackId', ...timingRequired],
    async (args, objectId) => {
      const trackId = requireString(args, 'trackId')
      const timing = readTiming(args)
      if (args.assetId !== undefined) {
        const assetId = requireString(args, 'assetId')
        if (args.objectChannels !== undefined) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            'assetId 和 objectChannels 只可传入一项',
          )
        }
        const asset = await animationAsset(runtime, assetId)
        const rig = await resolveModelRig(runtime, objectId)
        if (!rig || asset.rig !== rig) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            '动画资产与模型骨架不兼容',
          )
        }
        const duration = await durationMs(runtime, asset)
        return (object) => {
          if (findTrack(object, trackId).kind === 'object') {
            throw new AgentApiError(
              'INVALID_ARGUMENT',
              '动画资产需要 bone 轨道',
            )
          }
          return {
            stripId: insertAnimationStrip(
              object,
              trackId,
              assetId,
              duration,
              timing,
            ),
          }
        }
      }
      const selected = args.objectChannels
      if (
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some(
          (channel) => !channels.some((allowed) => channel === allowed),
        ) ||
        new Set(selected).size !== selected.length
      ) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'objectChannels 必须包含互不重复的对象通道',
        )
      }
      return (object) => {
        if (findTrack(object, trackId).kind !== 'object') {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            '对象通道需要 object 轨道',
          )
        }
        return {
          stripId: insertObjectAnimationStrip(
            object,
            trackId,
            timing,
            selected,
          ),
        }
      }
    },
    'stripId',
  )

  registerEdit(
    'updateTiming',
    {stripId: string, ...timingProperties},
    ['stripId', ...timingRequired],
    async (args, _objectId, object) => {
      const stripId = requireString(args, 'stripId')
      const timing = readTiming(args)
      const {strip} = findStrip(object, stripId)
      const duration = await stripDuration(runtime, strip)
      return (object) => {
        currentStrip(object, strip)
        commitAnimationStripTiming(object, strip, timing, duration)
      }
    },
  )

  registerEdit(
    'moveToTrack',
    {stripId: string, trackId: string},
    ['stripId', 'trackId'],
    async (args, _objectId, object) => {
      const stripId = requireString(args, 'stripId')
      const trackId = requireString(args, 'trackId')
      const {strip} = findStrip(object, stripId)
      const duration = await stripDuration(runtime, strip)
      return (object) => {
        const found = currentStrip(object, strip)
        const target = findTrack(object, trackId)
        if ((found.track.kind ?? 'bone') !== (target.kind ?? 'bone')) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            '目标轨道必须与源轨道类型一致',
          )
        }
        moveAnimationStripToTrack(object, strip, trackId, duration)
      }
    },
  )

  registerEdit('remove', {stripId: string}, ['stripId'], (args) => {
    const stripId = requireString(args, 'stripId')
    return (object) => {
      findStrip(object, stripId)
      removeAnimationStrip(object, stripId)
    }
  })
}
