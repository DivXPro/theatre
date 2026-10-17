/**
 * 场景查询命令(2026-10-17,Task 4):scene.getSnapshot / objects.list /
 * objects.get。全部 query/project、undoable:none,execute 前先
 * runtime.assertActive();无副作用由 objectResolver 保证。
 *
 * 同时产出 SceneApi/ObjectsApi 门面类型(Task 15 由同名命令转发实现);
 * ObjectsApi 的 update/delete 由后续任务补同一接口。
 */
import {getSceneObjectSummary, listSceneObjects} from '../objectResolver'
import type {SceneObjectSummary, SceneSnapshot} from '../objectResolver'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {requireObject, requireString} from '../validation'
import type {JsonSchema, SceneObjectId} from '../types'

export type {SceneObjectSummary, SceneSnapshot} from '../objectResolver'

/** 场景查询门面 */
export type SceneApi = {
  getSnapshot(): Promise<SceneSnapshot>
}

/** 完整对象门面类型;本任务实现 list/get,update/delete 由后续任务实现 */
export type ObjectsApi = {
  list(): Promise<SceneObjectSummary[]>
  get(args: {objectId: SceneObjectId}): Promise<SceneObjectSummary>
  update(args: {
    objectId: SceneObjectId
    props: Record<string, unknown>
    expectedRevision?: number
  }): Promise<{revision: number}>
  delete(args: {
    objectId: SceneObjectId
    expectedRevision?: number
  }): Promise<{deleted: SceneObjectId; revision: number}>
}

const summarySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: '带类型场景对象 ID,如 model:Y Bot'},
    kind: {type: 'string', enum: ['model', 'camera', 'anchor', 'path']},
    key: {type: 'string'},
    props: {
      type: 'object',
      description: '当前求值属性的深拷贝;未挂载为 null',
    },
    mounted: {type: 'boolean'},
  },
  required: ['id', 'kind', 'key', 'props', 'mounted'],
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

/** 无参命令的运行时校验:允许省略参数或空对象 */
function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
}

export function registerSceneCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<Record<string, unknown>, SceneSnapshot>({
    name: 'scene.getSnapshot',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: {
      type: 'object',
      properties: {
        revision: {type: 'number'},
        objects: {type: 'array', items: summarySchema},
      },
      required: ['revision', 'objects'],
    },
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      return {
        revision: runtime.revision,
        objects: listSceneObjects(runtime.sheet),
      }
    },
  })

  registry.register<Record<string, unknown>, SceneObjectSummary[]>({
    name: 'objects.list',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: {type: 'array', items: summarySchema},
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      return listSceneObjects(runtime.sheet)
    },
  })

  registry.register<{objectId: string}, SceneObjectSummary>({
    name: 'objects.get',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: objectIdInput,
    outputSchema: summarySchema,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
    ],
    validate: (value) => ({
      objectId: requireString(requireObject(value), 'objectId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      return getSceneObjectSummary(runtime.sheet, args.objectId)
    },
  })
}
