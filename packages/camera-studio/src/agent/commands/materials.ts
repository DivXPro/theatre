import {AgentApiError} from '../errors'
import {parseSceneObjectId} from '../objectIds'
import {resolveSceneSheetObject} from '../objectResolver'
import {
  assertStaticPropsWithLeafGuardWritable,
  setStaticPropsWithLeafGuard,
} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'
import {collectMaterialSlots} from '../../materials/modelMaterials'
import type {MaterialSlot, MaterialValues} from '../../materials/types'

export type MaterialsApi = {
  list(args: {objectId: string}): Promise<MaterialSlot[]>
  update(args: {
    objectId: string
    slotId: string
    values: Partial<MaterialValues>
    expectedRevision?: number
  }): Promise<{revision: number}>
}

type UpdateArgs = {
  objectId: string
  slotId: string
  values: Partial<MaterialValues>
  expectedRevision?: number
}

const materialValueProperties: Record<string, JsonSchema> = {
  color: {type: 'string', description: '#RRGGBB'},
  metalness: {type: 'number', description: '0..1'},
  roughness: {type: 'number', description: '0..1'},
  emissive: {type: 'string', description: '#RRGGBB'},
  opacity: {type: 'number', description: '0..1'},
  mapBlobId: {type: 'string', description: '贴图 blob ID;空字符串恢复原图'},
  normalMapBlobId: {type: 'string'},
  roughnessMapBlobId: {type: 'string'},
  metalnessMapBlobId: {type: 'string'},
  emissiveMapBlobId: {type: 'string'},
}

const materialValuesSchema: JsonSchema = {
  type: 'object',
  properties: materialValueProperties,
  additionalProperties: false,
}

const materialSlotSchema: JsonSchema = {
  type: 'object',
  properties: {
    slotId: {type: 'string'},
    slotKey: {type: 'string'},
    meshName: {type: 'string'},
    materialName: {type: 'string'},
    values: {
      ...materialValuesSchema,
      required: Object.keys(materialValueProperties),
    },
  },
  required: ['slotId', 'slotKey', 'meshName', 'materialName', 'values'],
}

function optionalExpectedRevision(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, 'expectedRevision')
}

function validateMaterialValues(value: unknown): Partial<MaterialValues> {
  const values = requireObject(value)
  const entries = Object.entries(values)
  if (entries.length === 0) {
    throw new AgentApiError('INVALID_ARGUMENT', 'values 不能为空对象')
  }
  for (const [key, input] of entries) {
    if (!(key in materialValueProperties)) {
      throw new AgentApiError('INVALID_ARGUMENT', `未知材质属性: ${key}`)
    }
    if (['metalness', 'roughness', 'opacity'].includes(key)) {
      const number = requireFiniteNumber(input, `values.${key}`)
      if (number < 0 || number > 1) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `values.${key} 必须在 0..1 范围内`,
        )
      }
    } else if (key === 'color' || key === 'emissive') {
      if (typeof input !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input)) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `values.${key} 必须是 #RRGGBB 颜色`,
        )
      }
    } else if (typeof input !== 'string') {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `values.${key} 必须是贴图 blob ID 或空字符串`,
      )
    }
  }
  return values as Partial<MaterialValues>
}

function mountedModel(runtime: AgentRuntime, objectId: string) {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId, 'model')
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `对象未挂载,无法访问材质: ${objectId}`,
      {details: {objectId}},
    )
  }
  const getModelPlacement = runtime.handlers.getModelPlacement
  if (!getModelPlacement) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Scene Runtime 未绑定 getModelPlacement,无法访问模型实例',
    )
  }
  const {key} = parseSceneObjectId(objectId)
  const placement = getModelPlacement({key})
  if (!placement) {
    throw new AgentApiError('INVALID_STATE', `模型实例未挂载: ${objectId}`, {
      details: {objectId},
    })
  }
  return {sheetObject, instance: placement.instance}
}

function evaluatedOverrides(sheetObject: {value: unknown}) {
  const value = sheetObject.value as Record<string, unknown>
  return (value.materialOverrides ?? {}) as Record<
    string,
    Partial<MaterialValues>
  >
}

export function registerMaterialCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<{objectId: string}, MaterialSlot[]>({
    name: 'materials.list',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {objectId: {type: 'string'}},
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: {type: 'array', items: materialSlotSchema},
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
    execute: async ({objectId}) => {
      runtime.assertActive()
      const {sheetObject, instance} = mountedModel(runtime, objectId)
      const overrides = evaluatedOverrides(sheetObject)
      return collectMaterialSlots(instance).map((slot) => ({
        ...slot,
        values: {...slot.values, ...overrides[slot.slotKey]},
      }))
    },
  })

  registry.register<UpdateArgs, {revision: number}>({
    name: 'materials.update',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {type: 'string'},
        slotId: {type: 'string'},
        values: materialValuesSchema,
        expectedRevision: {type: 'number'},
      },
      required: ['objectId', 'slotId', 'values'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {revision: {type: 'number'}},
      required: ['revision'],
    },
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
        slotId: requireString(args, 'slotId'),
        values: validateMaterialValues(args.values),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const {sheetObject, instance} = mountedModel(runtime, args.objectId)
      const slot = collectMaterialSlots(instance).find(
        (candidate) => candidate.slotId === args.slotId,
      )
      if (!slot) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `材质槽不存在: ${args.slotId}`,
          {details: {objectId: args.objectId, slotId: args.slotId}},
        )
      }
      const current = evaluatedOverrides(sheetObject)
      const materialOverrides = {
        ...current,
        [slot.slotKey]: {
          ...slot.values,
          ...current[slot.slotKey],
          ...args.values,
        },
      }
      const patch = {materialOverrides}
      const guardedPropPaths = Object.keys(args.values).map(
        (property) => `materialOverrides.${slot.slotKey}.${property}`,
      )
      assertStaticPropsWithLeafGuardWritable(
        sheetObject,
        patch,
        guardedPropPaths,
      )
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setStaticPropsWithLeafGuard(sheetObject, patch, guardedPropPaths)
      return {revision: await runtime.nextRevision()}
    },
  })
}
