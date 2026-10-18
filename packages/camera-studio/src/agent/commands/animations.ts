/**
 * animations 命令(2026-10-17,Task 9):apply / clear / getStatus。
 *
 * apply:验证 AnimationEntry 存在且与模型骨架族兼容(库模型条目 rig 优先——
 * GLB 导出洗骨骼名,实例重算可能不一致;本地 FBX 回退实例 rigIdOf;静态骨架
 * INVALID_STATE),再按静态语义写 props.animation(propAccess 形状 + 建轨
 * 校验;已建轨 INVALID_STATE,打帧走 keyframes.*)。clear 写空值。
 *
 * getStatus(会话域查询):loaded/error 只读 PlacementManager 的运行时登记
 * (agent/runtime/animationStatus,加载 effect 登记、cleanup 删除),绝不从
 * props 猜测——props 有值但无登记 = 加载中;登记的 assetId 与当前 props
 * 不符 = 陈旧登记,按加载中报。
 */
import {val} from '@dreamerbird/core'
import type {Group} from 'three'
import {AgentApiError} from '../errors'
import {resolveSceneSheetObject} from '../objectResolver'
import {parseSceneObjectId} from '../objectIds'
import {assertStaticPropsWritable, setStaticProps} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getAnimationLoadStatus} from '../runtime/animationStatus'
import type {AgentErrorDto, JsonSchema} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'
import {rigIdOf} from '../../assetLibrary/rig'
import type {AnimationEntry} from '../../assetLibrary/types'
import type {PlacementEntry} from '../../PlacementManager'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 取已放置模型的运行时实例与放置条目(与 poses.ts 中的同名声明一致,
     * 接口合并要求签名逐字相同)。
     */
    getModelPlacement(args: {
      key: string
    }): {entry: PlacementEntry; instance: Group} | undefined
  }
}

/** 动画资源状态(getStatus 输出;JS 与 HTTP 共用) */
export type AnimationStatusDto = {
  /** 当前 props.animation 引用的资产 id;未设置时缺省 */
  assetId?: string
  loaded: boolean
  error?: AgentErrorDto
}

/** 动画门面(Task 15 由同名命令转发实现) */
export type AnimationsApi = {
  apply(args: {
    objectId: string
    assetId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  clear(args: {
    objectId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  getStatus(args: {objectId: string}): Promise<AnimationStatusDto>
}

type ApplyArgs = {
  objectId: string
  assetId: string
  expectedRevision?: number
}
type ClearArgs = {objectId: string; expectedRevision?: number}
type GetStatusArgs = {objectId: string}

const objectIdProperty: JsonSchema = {
  type: 'string',
  description: '带类型场景对象 ID(模型),如 model:Y Bot',
}

const expectedRevisionProperty: JsonSchema = {
  type: 'number',
  description: '乐观并发:读取场景时的 revision',
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

const statusOutput: JsonSchema = {
  type: 'object',
  properties: {
    assetId: {type: 'string'},
    loaded: {type: 'boolean'},
    error: {
      type: 'object',
      properties: {
        code: {type: 'string'},
        message: {type: 'string'},
        retryable: {type: 'boolean'},
      },
      required: ['code', 'message', 'retryable'],
    },
  },
  required: ['loaded'],
}

function optionalExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return requireFiniteNumber(value, 'expectedRevision')
}

function resolveMountedModel(runtime: AgentRuntime, objectId: string) {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId, 'model')
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `对象未挂载,无法操作: ${objectId}`,
      {details: {objectId}},
    )
  }
  return sheetObject
}

/**
 * 模型骨架族:库模型条目 rig 优先,回退实例 rigIdOf。
 * handler 未绑定 SCENE_UNAVAILABLE;实例未挂载 INVALID_STATE;
 * 静态骨架(null)由调用方拒绝。
 */
async function resolveModelRig(
  runtime: AgentRuntime,
  objectId: string,
): Promise<string | null> {
  const getModelPlacement = runtime.handlers.getModelPlacement
  if (!getModelPlacement) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Scene Runtime 未绑定 getModelPlacement,无法验证骨架兼容性',
    )
  }
  const {key} = parseSceneObjectId(objectId)
  const placement = getModelPlacement({key})
  if (!placement) {
    throw new AgentApiError('INVALID_STATE', `模型实例未挂载: ${objectId}`, {
      details: {objectId},
    })
  }
  if (placement.entry.libraryEntryId) {
    const libEntry = await runtime.library.getEntry(
      placement.entry.libraryEntryId,
    )
    if (libEntry?.kind === 'model') return libEntry.rig
  }
  const rig = rigIdOf(placement.instance)
  return rig === 'static' ? null : rig
}

export function registerAnimationCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<ApplyArgs, {revision: number}>({
    name: 'animations.apply',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        assetId: {type: 'string', description: '动画资产条目 id'},
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'assetId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'ASSET_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        objectId: requireString(args, 'objectId'),
        assetId: requireString(args, 'assetId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      const entry = await runtime.library.getEntry(args.assetId)
      if (!entry) {
        throw new AgentApiError(
          'ASSET_NOT_FOUND',
          `资产不存在: ${args.assetId}`,
          {
            details: {assetId: args.assetId},
          },
        )
      }
      if (entry.kind !== 'animation') {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `资产 ${args.assetId} 不是动画(kind: ${entry.kind})`,
          {details: {assetId: args.assetId, kind: entry.kind}},
        )
      }
      // 骨架族兼容校验(UI 选择框对异族条目置灰,同一规则)
      const modelRig = await resolveModelRig(runtime, args.objectId)
      if (modelRig === null) {
        throw new AgentApiError(
          'INVALID_STATE',
          `静态骨架模型不能应用动画: ${args.objectId}`,
          {details: {objectId: args.objectId}},
        )
      }
      if ((entry as AnimationEntry).rig !== modelRig) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `动画 ${args.assetId} 的骨架族(${
            (entry as AnimationEntry).rig
          })与模型(${modelRig})不兼容`,
          {
            details: {
              assetId: args.assetId,
              assetRig: (entry as AnimationEntry).rig,
              modelRig,
            },
          },
        )
      }
      // 建轨预检先于乐观并发与事务(同 objects.update)
      assertStaticPropsWritable(sheetObject, {animation: args.assetId})
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setStaticProps(sheetObject, {animation: args.assetId})
      return {revision: await runtime.nextRevision()}
    },
  })

  registry.register<ClearArgs, {revision: number}>({
    name: 'animations.clear',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        objectId: requireString(args, 'objectId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      assertStaticPropsWritable(sheetObject, {animation: ''})
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setStaticProps(sheetObject, {animation: ''})
      return {revision: await runtime.nextRevision()}
    },
  })

  registry.register<GetStatusArgs, AnimationStatusDto>({
    name: 'animations.getStatus',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {objectId: objectIdProperty},
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: statusOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
    ],
    validate: (value) => ({
      objectId: requireString(requireObject(value), 'objectId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      const current =
        (val(sheetObject.props.animation as never) as string | undefined) ?? ''
      // 未设置
      if (!current) return {loaded: false}
      const {key} = parseSceneObjectId(args.objectId)
      const status = getAnimationLoadStatus(key)
      // 无登记(加载中)或登记陈旧(assetId 对不上):如实报加载中
      if (!status || status.assetId !== current) {
        return {assetId: current, loaded: false}
      }
      return {
        assetId: current,
        loaded: status.loaded,
        ...(status.error ? {error: status.error} : {}),
      }
    },
  })
}
