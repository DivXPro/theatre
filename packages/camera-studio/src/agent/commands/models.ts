/**
 * models.create(2026-10-17,Task 8):从模型资产直接创建到指定位置。
 *
 * 执行顺序:assertActive → project.ready → Library 取条目
 * (缺失 ASSET_NOT_FOUND / 非模型 INVALID_ARGUMENT) → expectedRevision
 * 乐观并发(任何副作用之前) → Scene Runtime createModel handler
 * (未绑定 SCENE_UNAVAILABLE;生产由 CameraScene 绑定,转发
 * placeLibraryEntryAt) → 等 persisted(completion:mounted;失败
 * RESOURCE_LOAD_FAILED,期间 dispose 优先映射 API_DISPOSED) →
 * resolver 复核注册表与 SheetObject 双双可见(脱节 = INTERNAL_ERROR,
 * 不静默成功)。
 *
 * 撤销粒度:PlacedModelCore 的注册表提交是单个 scrub commit,整个命令
 * 对历史只呈现一步(undoable:single-step)。
 */
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {formatSceneObjectId} from '../objectIds'
import {getSceneObjectSummary} from '../objectResolver'
import type {JsonSchema, SceneObjectId, Vec3} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'
import type {ModelEntry} from '../../assetLibrary/types'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 把库模型条目放置到指定位置(CameraScene 绑定,转发
     * placeLibraryEntryAt):同步生成 key、创建挂载 waiter、设置 pending
     * 条目,立即返回;persisted 在注册表提交 + pending 清理后兑现,
     * 挂载/加载失败或提前卸载时拒绝。
     */
    createModel(args: {entry: ModelEntry; position: Vec3}): {
      key: string
      persisted: Promise<void>
    }
  }
}

/** 模型门面(Task 15 由同名命令转发实现) */
export type ModelsApi = {
  create(args: {
    assetId: string
    position: Vec3
    expectedRevision?: number
  }): Promise<{objectId: SceneObjectId; revision: number}>
}

type CreateArgs = {
  assetId: string
  position: Vec3
  expectedRevision?: number
}

const vec3Schema: JsonSchema = {
  type: 'object',
  properties: {
    x: {type: 'number'},
    y: {type: 'number'},
    z: {type: 'number'},
  },
  required: ['x', 'y', 'z'],
  additionalProperties: false,
}

const createInput: JsonSchema = {
  type: 'object',
  properties: {
    assetId: {type: 'string', description: '模型资产条目 id'},
    position: {...vec3Schema, description: '创建位置(世界坐标)'},
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  required: ['assetId', 'position'],
  additionalProperties: false,
}

const createOutput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {type: 'string', description: '带类型场景对象 ID,model:<key>'},
    revision: {type: 'number'},
  },
  required: ['objectId', 'revision'],
}

function validateCreate(value: unknown): CreateArgs {
  const args = requireObject(value)
  const assetId = requireString(args, 'assetId')
  const position = requireVec3(args.position)
  let expectedRevision: number | undefined
  if (args.expectedRevision !== undefined) {
    expectedRevision = requireFiniteNumber(
      args.expectedRevision,
      'expectedRevision',
    )
  }
  return {assetId, position, expectedRevision}
}

export function registerModelCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<CreateArgs, {objectId: SceneObjectId; revision: number}>({
    name: 'models.create',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'mounted',
    inputSchema: createInput,
    outputSchema: createOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'ASSET_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
      'RESOURCE_LOAD_FAILED',
      'INTERNAL_ERROR',
    ],
    validate: validateCreate,
    execute: async (args) => {
      runtime.assertActive()
      // 资产读取与就绪等待都在副作用之前(事务外异步准备,spec 8.6.1)
      await runtime.project.ready
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
      if (entry.kind !== 'model') {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `资产 ${args.assetId} 不是模型(kind: ${entry.kind})`,
          {details: {assetId: args.assetId, kind: entry.kind}},
        )
      }
      // 乐观并发:先于任何副作用(setPendingEntry 经 handler 触发)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      const createModel = runtime.handlers.createModel
      if (!createModel) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Scene Runtime 未绑定 createModel,无法创建模型',
        )
      }
      const placed = createModel({entry, position: args.position})
      try {
        await placed.persisted
      } catch (error) {
        // dispose 优先于挂载失败:会话已销毁时统一 API_DISPOSED
        runtime.assertActive()
        throw new AgentApiError(
          'RESOURCE_LOAD_FAILED',
          `模型挂载失败: ${entry.name}`,
          {
            details: {
              assetId: args.assetId,
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        )
      }
      runtime.assertActive()
      const objectId = formatSceneObjectId('model', placed.key)
      // persisted 兑现后注册表与 SheetObject 必须双双可见;
      // 任何脱节都是内部不变量被破坏,不是调用方的「对象不存在」
      let mounted: boolean
      try {
        mounted = getSceneObjectSummary(runtime.sheet, objectId).mounted
      } catch (error) {
        throw new AgentApiError(
          'INTERNAL_ERROR',
          `放置已提交但场景对象不可见: ${objectId}`,
          {
            details: {
              objectId,
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        )
      }
      if (!mounted) {
        throw new AgentApiError(
          'INTERNAL_ERROR',
          `放置已提交但 SheetObject 未登记: ${objectId}`,
          {details: {objectId}},
        )
      }
      return {objectId, revision: await runtime.nextRevision()}
    },
  })
}
