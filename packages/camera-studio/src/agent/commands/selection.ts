/**
 * 选择命令(2026-10-17,Task 4):selection.get / selectObject / clear。
 * 选择是会话状态:全部 mutation/session、undoable:none(spec 9 选择行:
 * 清空时同时清理相关会话选择 —— clearPathPointSelection handler)。
 * 选择解析只认 objectRuntime 里登记的四种业务对象 SheetObject。
 */
import type {ISheetObject} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import {resolveSceneSheetObject} from '../objectResolver'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {resolveSceneObjectId} from '../runtime/objectRuntime'
import {requireObject, requireString} from '../validation'
import type {JsonSchema, SceneObjectId} from '../types'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /** 清理路径控制点的会话选择(CameraScene 绑定;selection.clear 时调用) */
    clearPathPointSelection(): void
  }
}

/** 选择门面(Task 15 由同名命令转发实现) */
export type SelectionApi = {
  get(): Promise<{objectIds: SceneObjectId[]}>
  selectObject(args: {objectId: SceneObjectId}): Promise<void>
  clear(): Promise<void>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}

const objectIdInput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {type: 'string', description: '带类型场景对象 ID,如 model:Y Bot'},
  },
  required: ['objectId'],
  additionalProperties: false,
}

const voidOutput: JsonSchema = {type: 'object', additionalProperties: false}

function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
}

function requireStudio(runtime: AgentRuntime) {
  const studio = runtime.getStudio()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用')
  }
  return studio
}

export function registerSelectionCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<Record<string, unknown>, {objectIds: SceneObjectId[]}>({
    name: 'selection.get',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: {
      type: 'object',
      properties: {
        objectIds: {type: 'array', items: {type: 'string'}},
      },
      required: ['objectIds'],
    },
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      const studio = requireStudio(runtime)
      const objectIds: SceneObjectId[] = []
      for (const item of studio.selection as unknown[]) {
        const id = resolveSceneObjectId(item)
        if (id) objectIds.push(id)
      }
      return {objectIds}
    },
  })

  registry.register<{objectId: string}, void>({
    name: 'selection.selectObject',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: objectIdInput,
    outputSchema: voidOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => ({
      objectId: requireString(requireObject(value), 'objectId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      // 先解析(类型/存在性),再要求 Studio 在线
      const obj: ISheetObject<any> | undefined = resolveSceneSheetObject(
        runtime.sheet,
        args.objectId,
      )
      const studio = requireStudio(runtime)
      if (!obj) {
        throw new AgentApiError(
          'INVALID_STATE',
          `对象已登记但尚未挂载,无法选择: ${args.objectId}`,
          {details: {objectId: args.objectId}},
        )
      }
      studio.setSelection([obj])
    },
  })

  registry.register<Record<string, unknown>, void>({
    name: 'selection.clear',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      const studio = requireStudio(runtime)
      studio.setSelection([])
      // 路径控制点选择等会话态一并清理(CameraScene 未绑定时静默跳过)
      runtime.handlers.clearPathPointSelection?.()
    },
  })
}
