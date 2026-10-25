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
import {PRIMITIVE_KINDS} from '../../primitives'
import type {PrimitiveKind} from '../../primitives'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    createPrimitive(args: {kind: PrimitiveKind; position: Vec3}): {
      key: string
      persisted: Promise<void>
    }
  }
}

export type PrimitivesApi = {
  create(args: {
    kind: PrimitiveKind
    position: Vec3
    expectedRevision?: number
  }): Promise<{objectId: SceneObjectId; revision: number}>
}

type CreateArgs = {
  kind: PrimitiveKind
  position: Vec3
  expectedRevision?: number
}

const createInput: JsonSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [...PRIMITIVE_KINDS],
      description: '米制基础几何体类型',
    },
    position: {
      type: 'object',
      properties: {
        x: {type: 'number'},
        y: {type: 'number'},
        z: {type: 'number'},
      },
      required: ['x', 'y', 'z'],
      additionalProperties: false,
      description: '创建位置(世界坐标)',
    },
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  required: ['kind', 'position'],
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
  const kind = requireString(args, 'kind')
  if (!(PRIMITIVE_KINDS as readonly string[]).includes(kind)) {
    throw new AgentApiError('INVALID_ARGUMENT', `未知基础几何体类型: ${kind}`, {
      details: {kind},
    })
  }
  const position = requireVec3(args.position)
  let expectedRevision: number | undefined
  if (args.expectedRevision !== undefined) {
    expectedRevision = requireFiniteNumber(
      args.expectedRevision,
      'expectedRevision',
    )
  }
  return {kind: kind as PrimitiveKind, position, expectedRevision}
}

export function registerPrimitiveCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<CreateArgs, {objectId: SceneObjectId; revision: number}>({
    name: 'primitives.create',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'mounted',
    inputSchema: createInput,
    outputSchema: createOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
      'RESOURCE_LOAD_FAILED',
      'INTERNAL_ERROR',
    ],
    validate: validateCreate,
    execute: async (args) => {
      runtime.assertActive()
      await runtime.project.ready
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      const createPrimitive = runtime.handlers.createPrimitive
      if (!createPrimitive) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Scene Runtime 未绑定 createPrimitive,无法创建基础几何体',
        )
      }
      const placed = createPrimitive({kind: args.kind, position: args.position})
      try {
        await placed.persisted
      } catch (error) {
        runtime.assertActive()
        throw new AgentApiError(
          'RESOURCE_LOAD_FAILED',
          `基础几何体挂载失败: ${args.kind}`,
          {
            details: {
              kind: args.kind,
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        )
      }
      runtime.assertActive()
      const objectId = formatSceneObjectId('model', placed.key)
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
