import {
  evaluateCharacterPath,
  setCharacterPathBinding,
} from '../../characterPaths'
import {AgentApiError} from '../errors'
import {formatSceneObjectId, parseSceneObjectId} from '../objectIds'
import {resolveSceneSheetObject} from '../objectResolver'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {SceneObjectId} from '../types'
import {
  requireBoolean,
  requireFiniteNumber,
  requireObject,
  requireString,
} from '../validation'

export type CharacterPathState = {
  status: 'unbound' | 'missing' | 'active'
  pathId?: SceneObjectId
  orient: boolean
  progress: number
}

export type CharacterPathsApi = {
  get(args: {objectId: string}): Promise<CharacterPathState>
  bind(args: {
    objectId: string
    pathId: string
    orient?: boolean
    expectedRevision?: number
  }): Promise<{revision: number}>
  unbind(args: {
    objectId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
}

function resolveCharacter(runtime: AgentRuntime, objectId: string) {
  runtime.assertCurrent()
  const model = resolveSceneSheetObject(runtime.sheet, objectId, 'model')
  if (!model)
    throw new AgentApiError('INVALID_STATE', `模型未挂载: ${objectId}`)
  if (typeof model.value.characterPathId !== 'string') {
    throw new AgentApiError('INVALID_STATE', `模型不支持角色路径: ${objectId}`)
  }
  return model
}

const objectId = {type: 'string', description: '带 model: 前缀的角色 ID'}
const expectedRevision = {type: 'number'}
const errors = [
  'API_DISPOSED',
  'API_NOT_READY',
  'INVALID_ARGUMENT',
  'INVALID_ID_KIND',
  'OBJECT_NOT_FOUND',
  'INVALID_STATE',
  'REVISION_CONFLICT',
] as const

export function registerCharacterPathCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
) {
  registry.register({
    name: 'characterPaths.get',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {objectId},
      required: ['objectId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {type: 'string', enum: ['unbound', 'missing', 'active']},
        pathId: {type: 'string', description: '带 path: 前缀的路径对象 ID'},
        orient: {type: 'boolean'},
        progress: {
          type: 'number',
          description: '当前时间轴求值的路径进度（0–100）',
        },
      },
      required: ['status', 'orient', 'progress'],
    },
    errorCodes: errors,
    validate: (value) => requireString(requireObject(value), 'objectId'),
    execute: async (id): Promise<CharacterPathState> => {
      const model = resolveCharacter(runtime, id)
      const values = model.value
      const evaluation = evaluateCharacterPath(runtime.sheet, values)
      return {
        status: evaluation.status,
        ...(evaluation.status !== 'unbound' && evaluation.pathKey
          ? {pathId: formatSceneObjectId('path', evaluation.pathKey)}
          : {}),
        orient: values.characterPathOrient ?? true,
        progress: values.characterPathProgress ?? 0,
      }
    },
  })

  for (const bind of [true, false]) {
    registry.register({
      name: bind ? 'characterPaths.bind' : 'characterPaths.unbind',
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      inputSchema: {
        type: 'object',
        properties: {
          objectId,
          expectedRevision,
          ...(bind
            ? {
                pathId: {
                  type: 'string',
                  description: '带 path: 前缀的路径对象 ID',
                },
                orient: {
                  type: 'boolean',
                  description: '是否沿曲线切向转身，默认为 true',
                },
              }
            : {}),
        },
        required: bind ? ['objectId', 'pathId'] : ['objectId'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {revision: {type: 'number'}},
        required: ['revision'],
      },
      errorCodes: errors,
      validate: (value) => {
        const args = requireObject(value)
        const id = requireString(args, 'objectId')
        const revision =
          args.expectedRevision === undefined
            ? undefined
            : requireFiniteNumber(args.expectedRevision, 'expectedRevision')
        if (!bind) return {id, revision, pathKey: '', orient: true}
        const pathId = requireString(args, 'pathId')
        const {kind, key} = parseSceneObjectId(pathId)
        if (kind !== 'path')
          throw new AgentApiError('INVALID_ID_KIND', `需要路径 ID: ${pathId}`)
        return {
          id,
          revision,
          pathKey: key,
          orient:
            args.orient === undefined ? true : requireBoolean(args, 'orient'),
        }
      },
      execute: async ({id, revision, pathKey, orient}) => {
        const model = resolveCharacter(runtime, id)
        if (revision !== undefined) runtime.assertRevision(revision)
        if (
          pathKey &&
          !resolveSceneSheetObject(
            runtime.sheet,
            formatSceneObjectId('path', pathKey),
            'path',
          )
        ) {
          throw new AgentApiError('INVALID_STATE', `角色路径未挂载: ${pathKey}`)
        }
        if (!pathKey && !model.value.characterPathId)
          return {revision: runtime.revision}
        const result = setCharacterPathBinding(model, {pathKey, orient})
        if (!result.ok) throw new AgentApiError('INVALID_STATE', result.message)
        return {revision: await runtime.nextRevision()}
      },
    })
  }
}
