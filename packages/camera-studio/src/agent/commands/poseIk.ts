import {getPoseSession} from '../../poseMode/poseSession'
import type {IkPoint, IkTarget} from '../../poseMode/fullbodyControls'
import {AgentApiError} from '../errors'
import {formatSceneObjectId} from '../objectIds'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getPoseSessionRig} from '../runtime/poseSessionRuntime'
import type {SceneObjectId} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'

export type PoseIkApi = {
  listIkPoints(): Promise<{objectId: SceneObjectId; points: IkPoint[]}>
  setIkTarget(
    args: IkTarget,
  ): Promise<{objectId: SceneObjectId; point: IkPoint}>
}

const number = {type: 'number'}
const coordinates = {x: number, y: number, z: number}
const position = {
  type: 'object',
  properties: coordinates,
  required: ['x', 'y', 'z'],
}
const quaternion = {
  type: 'object',
  properties: {...coordinates, w: number},
  required: ['x', 'y', 'z', 'w'],
}
const point = {
  type: 'object',
  properties: {
    pointId: {type: 'string'},
    position,
    quaternion,
    canRotate: {type: 'boolean'},
  },
  required: ['pointId', 'position', 'quaternion', 'canRotate'],
}
const objectId = {type: 'string'}
const errors = [
  'API_DISPOSED',
  'API_NOT_READY',
  'INVALID_ARGUMENT',
  'INVALID_STATE',
] as const

function activeRig(runtime: AgentRuntime) {
  runtime.assertActive()
  const session = getPoseSession()
  const rig = session && getPoseSessionRig(session.key)?.fullbody
  if (!session || !rig) {
    throw new AgentApiError(
      'INVALID_STATE',
      '当前没有已挂载的 Fullbody IK 姿势会话',
    )
  }
  return {objectId: formatSceneObjectId('model', session.key), rig}
}

export function registerPoseIkCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
) {
  registry.register({
    name: 'poses.session.listIkPoints',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {type: 'object', additionalProperties: false},
    outputSchema: {
      type: 'object',
      properties: {objectId, points: {type: 'array', items: point}},
      required: ['objectId', 'points'],
    },
    errorCodes: errors,
    validate: (value) => {
      if (value !== undefined && Object.keys(requireObject(value)).length) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'poses.session.listIkPoints 无参数',
        )
      }
    },
    execute: async () => {
      const {objectId, rig} = activeRig(runtime)
      return {objectId, points: rig.listIkPoints()}
    },
  })

  registry.register({
    name: 'poses.session.setIkTarget',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {pointId: {type: 'string'}, position, quaternion},
      required: ['pointId'],
      additionalProperties: false,
      description: '至少指定世界坐标 position 或世界旋转 quaternion 之一',
    },
    outputSchema: {
      type: 'object',
      properties: {objectId, point},
      required: ['objectId', 'point'],
    },
    errorCodes: errors,
    validate: (value): IkTarget => {
      const args = requireObject(value)
      const target: IkTarget = {pointId: requireString(args, 'pointId')}
      if (args.position !== undefined)
        target.position = requireVec3(args.position)
      if (args.quaternion !== undefined) {
        const raw = requireObject(args.quaternion)
        const {x, y, z} = requireVec3(raw, 'quaternion')
        const w = requireFiniteNumber(raw.w, 'quaternion.w')
        const length = Math.hypot(x, y, z, w)
        if (!Number.isFinite(length) || length < 1e-10) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            'quaternion 必须具有非零有限长度',
          )
        }
        target.quaternion = {
          x: x / length,
          y: y / length,
          z: z / length,
          w: w / length,
        }
      }
      if (!target.position && !target.quaternion) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          '请提供 position 或 quaternion',
        )
      }
      return target
    },
    execute: async (target) => {
      const {objectId, rig} = activeRig(runtime)
      const current = rig
        .listIkPoints()
        .find((entry) => entry.pointId === target.pointId)
      if (!current)
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `未知 IK 控制点: ${target.pointId}`,
        )
      if (target.quaternion && !current.canRotate) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `IK 控制点不支持旋转: ${target.pointId}`,
        )
      }
      const point = rig.setIkTarget(target)
      if (!point)
        throw new AgentApiError('INVALID_STATE', 'IK 控制点正在被拖动')
      return {objectId, point}
    },
  })
}
