/**
 * paths / paths.session 命令(2026-10-17,Task 11):listPresets /
 * createPreset / addPoint / updatePoint / deletePoint / setPointTiming /
 * sample + startEditing / exitEditing / selectPoint。
 *
 * 执行顺序(写命令):assertActive → 参数/类型/存在性校验(点级校验在
 * pathCommands 领域函数内) → beforeWrite 里做 expectedRevision 乐观并发
 * (先于任何副作用,同 cameras 排序) → 单个事务写完(一个命令一个
 * 撤销步骤)。删除最后一点 = 整路径删除,走 deletePathDomain(含相机
 * 回退与注册表清理,Task 14 共用)。
 *
 * sample 是查询:只认注册表清单(privateAPI 探测,不创建)与
 * pathRuntime 里 CameraPath 登记的采样器(与当前渲染同一曲线实现);
 * 路径未挂载返回 INVALID_STATE,绝不调会创建 meta 的读取函数
 * (getPathMeta/readPathPoints)。
 *
 * 会话命令(session 域,undoable:none)经 Scene Runtime handler
 * (生产由 CameraScene 绑定,Task 15 接线):exitPathEditing 清编辑态,
 * 点选择经 selection.clear 同款的 clearPathPointSelection 一并清理。
 */
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {ISheet} from '@dreamerbird/core'
import {Vector3} from 'three'
import {formatSceneObjectId, parseSceneObjectId} from '../objectIds'
import {listSceneObjectKeys} from '../objectResolver'
import type {JsonSchema, SceneObjectId, Vec3} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'
import {pathExists, readPathPoints} from '../../CameraPath'
import {PATH_PRESETS} from '../../pathPresets'
import {
  addPathPointDomain,
  createPresetPath,
  defaultPresetSpot,
  deletePathPointDomain,
  setPathPointTimingDomain,
  updatePathPointDomain,
} from '../pathCommands'
import {getPathSampler} from '../runtime/pathRuntime'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 进入路径编辑模式(CameraScene 绑定,转发 enterPathEdit:置编辑态
     * 并清掉 theatre 对象选中,两套 gizmo 不同时出现);pathKey 的存在性
     * 由命令侧先校验。
     */
    startPathEditing(args: {pathKey: string}): void
    /**
     * 退出路径编辑模式(CameraScene 绑定,失焦式退出:清编辑态,
     * 不回头重选路径本体)。
     */
    exitPathEditing(): void
    /**
     * 选中路径控制点(CameraScene 绑定);路径正在编辑与点存在性
     * 由命令侧先校验。
     */
    selectPathPoint(args: {pathKey: string; pointKey: string}): void
    /**
     * 当前路径编辑会话状态(selectPoint 的"路径正在编辑"校验用);
     * 未编辑时 pathKey 为 null。
     */
    getPathEditingState(): {pathKey: string | null; pointKey: string | null}
  }
}

/** 预设条目 DTO(listPresets 输出;与 PathPreset 同形状的可序列化子集) */
export type PathPresetInfo = {
  id: string
  name: string
  en: string
  closed: boolean
  durSeconds: number
}

/** 路径门面(Task 15 由同名命令转发实现) */
export type PathsApi = {
  listPresets(): Promise<PathPresetInfo[]>
  createPreset(args: {
    preset: string
    at?: Vec3
    expectedRevision?: number
  }): Promise<{pathId: SceneObjectId; pointKeys: string[]; revision: number}>
  addPoint(args: {
    pathId: SceneObjectId
    expectedRevision?: number
  }): Promise<{pointKey: string; revision: number}>
  updatePoint(args: {
    pathId: SceneObjectId
    pointKey: string
    position?: Vec3
    handles?: {side: 'left' | 'right'; offset: Vec3}
    expectedRevision?: number
  }): Promise<{revision: number}>
  deletePoint(args: {
    pathId: SceneObjectId
    pointKey: string
    expectedRevision?: number
  }): Promise<{revision: number; pathDeleted: boolean}>
  setPointTiming(args: {
    pathId: SceneObjectId
    pointKey: string
    u: number | null
    expectedRevision?: number
  }): Promise<{revision: number}>
  sample(args: {pathId: SceneObjectId; u: number}): Promise<{position: Vec3}>
}

/** 路径编辑会话门面(Task 15 由同名命令转发实现) */
export type PathsSessionApi = {
  startEditing(args: {pathId: SceneObjectId}): Promise<void>
  exitEditing(): Promise<void>
  selectPoint(args: {pathId: SceneObjectId; pointKey: string}): Promise<void>
}

type CreatePresetArgs = {
  preset: string
  at?: Vec3
  expectedRevision?: number
}
type PathRefArgs = {pathId: string; expectedRevision?: number}
type UpdatePointArgs = {
  pathId: string
  pointKey: string
  position?: Vec3
  handles?: {side: 'left' | 'right'; offset: Vec3}
  expectedRevision?: number
}
type DeletePointArgs = {
  pathId: string
  pointKey: string
  expectedRevision?: number
}
type SetPointTimingArgs = {
  pathId: string
  pointKey: string
  u: number | null
  expectedRevision?: number
}
type SampleArgs = {pathId: string; u: number}

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

const pathIdProperty: JsonSchema = {
  type: 'string',
  description: '带类型路径 ID,path:<key>',
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

const voidOutput: JsonSchema = {type: 'object', additionalProperties: false}

function optionalExpectedRevision(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, 'expectedRevision')
}

/**
 * 解析带类型路径 ID 到已登记 pathKey:类型不符 INVALID_ID_KIND,
 * 注册表没有 OBJECT_NOT_FOUND(只探测,不创建)。
 */
function resolveRegisteredPathKey(sheet: ISheet, pathId: string): string {
  const {kind, key} = parseSceneObjectId(pathId)
  if (kind !== 'path') {
    throw new AgentApiError(
      'INVALID_ID_KIND',
      `对象 ${pathId} 的类型是 ${kind},此处需要 path`,
      {details: {objectId: pathId, kind, expectedKind: 'path'}},
    )
  }
  if (!listSceneObjectKeys(sheet, 'path').includes(key)) {
    throw new AgentApiError('OBJECT_NOT_FOUND', `路径不存在: ${pathId}`, {
      details: {objectId: pathId, kind: 'path'},
    })
  }
  return key
}

/** 未绑定 Scene Runtime handler = SCENE_UNAVAILABLE(不静默成功) */
function requireHandler<K extends keyof AgentRuntime['handlers']>(
  runtime: AgentRuntime,
  key: K,
): NonNullable<AgentRuntime['handlers'][K]> {
  const handler = runtime.handlers[key]
  if (!handler) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      `Scene Runtime 未绑定 ${String(key)},路径编辑会话不可用`,
    )
  }
  return handler
}

export function registerPathCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  const revisionGuard = (expectedRevision: number | undefined) => () => {
    if (expectedRevision !== undefined) runtime.assertRevision(expectedRevision)
  }

  registry.register<Record<string, unknown>, PathPresetInfo[]>({
    name: 'paths.listPresets',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {type: 'object', additionalProperties: false},
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          name: {type: 'string'},
          en: {type: 'string'},
          closed: {type: 'boolean'},
          durSeconds: {type: 'number'},
        },
        required: ['id', 'name', 'en', 'closed', 'durSeconds'],
      },
    },
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: (value) =>
      value === undefined || value === null ? {} : requireObject(value),
    execute: async () => {
      runtime.assertActive()
      // 纯静态数据:不碰 sheet,零副作用
      return PATH_PRESETS.map(({id, name, en, closed, durSeconds}) => ({
        id,
        name,
        en,
        closed,
        durSeconds,
      }))
    },
  })

  registry.register<
    CreatePresetArgs,
    {pathId: SceneObjectId; pointKeys: string[]; revision: number}
  >({
    name: 'paths.createPreset',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          description: '预设 id(paths.listPresets 返回)',
        },
        at: {...vec3Schema, description: '显式落点(世界坐标);缺省自动避让'},
        expectedRevision: expectedRevisionProperty,
      },
      required: ['preset'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        pathId: {type: 'string', description: '带类型路径 ID,path:<key>'},
        pointKeys: {
          type: 'array',
          items: {type: 'string'},
          description: '播下的控制点 key(P1..Pn)',
        },
        revision: {type: 'number'},
      },
      required: ['pathId', 'pointKeys', 'revision'],
    },
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      const preset = requireString(args, 'preset')
      let at: Vec3 | undefined
      if (args.at !== undefined) at = requireVec3(args.at, 'at')
      return {
        preset,
        at,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const preset = PATH_PRESETS.find((p) => p.id === args.preset)
      if (!preset) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `未知路径预设: ${args.preset}(可用:${PATH_PRESETS.map(
            (p) => p.id,
          ).join(', ')})`,
          {details: {preset: args.preset}},
        )
      }
      // 落点:显式 at 优先;缺省 findFreeSpot 避开已有放置/路径原点
      const center = args.at ?? defaultPresetSpot(runtime.sheet)
      const {pathKey, pointKeys} = createPresetPath(
        runtime.sheet,
        preset,
        center,
        revisionGuard(args.expectedRevision),
      )
      return {
        pathId: formatSceneObjectId('path', pathKey),
        pointKeys,
        revision: runtime.revision,
      }
    },
  })

  registry.register<PathRefArgs, {pointKey: string; revision: number}>({
    name: 'paths.addPoint',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['pathId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        pointKey: {type: 'string'},
        revision: {type: 'number'},
      },
      required: ['pointKey', 'revision'],
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
        pathId: requireString(args, 'pathId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      const {pointKey} = addPathPointDomain(
        runtime.sheet,
        key,
        revisionGuard(args.expectedRevision),
      )
      return {pointKey, revision: runtime.revision}
    },
  })

  registry.register<UpdatePointArgs, {revision: number}>({
    name: 'paths.updatePoint',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        pointKey: {type: 'string', description: '控制点 key,如 P2'},
        position: {
          ...vec3Schema,
          description: '新位置(相对路径原点的局部坐标)',
        },
        handles: {
          type: 'object',
          properties: {
            side: {type: 'string', enum: ['left', 'right']},
            offset: {
              ...vec3Schema,
              description: '被拖侧手柄相对控制点的新偏移',
            },
          },
          required: ['side', 'offset'],
          additionalProperties: false,
          description: '拖手柄(对齐规则,同 UI):被拖侧取新偏移,另一侧共线镜像',
        },
        expectedRevision: expectedRevisionProperty,
      },
      required: ['pathId', 'pointKey'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'PATH_POINT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      const pathId = requireString(args, 'pathId')
      const pointKey = requireString(args, 'pointKey')
      let position: Vec3 | undefined
      if (args.position !== undefined) {
        position = requireVec3(args.position, 'position')
      }
      let handles: {side: 'left' | 'right'; offset: Vec3} | undefined
      if (args.handles !== undefined) {
        const raw = requireObject(args.handles)
        const side = raw.side
        if (side !== 'left' && side !== 'right') {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            "handles.side 必须是 'left' 或 'right'",
            {details: {side}},
          )
        }
        handles = {side, offset: requireVec3(raw.offset, 'handles.offset')}
      }
      if (!position && !handles) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'updatePoint 需要 position 或 handles 至少一项',
        )
      }
      return {
        pathId,
        pointKey,
        position,
        handles,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      updatePathPointDomain(
        runtime.sheet,
        key,
        args.pointKey,
        {
          position: args.position,
          handle: args.handles,
        },
        revisionGuard(args.expectedRevision),
      )
      return {revision: runtime.revision}
    },
  })

  registry.register<DeletePointArgs, {revision: number; pathDeleted: boolean}>({
    name: 'paths.deletePoint',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        pointKey: {type: 'string', description: '控制点 key,如 P2'},
        expectedRevision: expectedRevisionProperty,
      },
      required: ['pathId', 'pointKey'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        revision: {type: 'number'},
        pathDeleted: {
          type: 'boolean',
          description: '删掉的是最后一点 → 整条路径已删除(含相机回退)',
        },
      },
      required: ['revision', 'pathDeleted'],
    },
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'PATH_POINT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        pathId: requireString(args, 'pathId'),
        pointKey: requireString(args, 'pointKey'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      const {pathDeleted} = deletePathPointDomain(
        runtime.sheet,
        key,
        args.pointKey,
        revisionGuard(args.expectedRevision),
      )
      return {revision: runtime.revision, pathDeleted}
    },
  })

  registry.register<SetPointTimingArgs, {revision: number}>({
    name: 'paths.setPointTiming',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        pointKey: {type: 'string', description: '控制点 key(限内部点)'},
        u: {
          type: 'number',
          description:
            '全程进度锚点(0~1,夹到相邻锚点之间);null = 恢复自动(弧长等比);首尾点固定 0/1 不可调',
        },
        expectedRevision: expectedRevisionProperty,
      },
      required: ['pathId', 'pointKey', 'u'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'PATH_POINT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      const pathId = requireString(args, 'pathId')
      const pointKey = requireString(args, 'pointKey')
      const rawU = args.u
      let u: number | null
      if (rawU === null) {
        u = null
      } else {
        u = requireFiniteNumber(rawU, 'u')
        if (u < 0 || u > 1) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            `u 必须在 0~1 之间,收到: ${u}`,
            {details: {u}},
          )
        }
      }
      return {
        pathId,
        pointKey,
        u,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      setPathPointTimingDomain(
        runtime.sheet,
        key,
        args.pointKey,
        args.u,
        revisionGuard(args.expectedRevision),
      )
      return {revision: runtime.revision}
    },
  })

  registry.register<SampleArgs, {position: Vec3}>({
    name: 'paths.sample',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        u: {type: 'number', description: '全程进度(0~1,超出按边界夹取)'},
      },
      required: ['pathId', 'u'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        position: {...vec3Schema, description: '世界坐标采样点'},
      },
      required: ['position'],
    },
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        pathId: requireString(args, 'pathId'),
        u: requireFiniteNumber(args.u, 'u'),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      // 只探测不创建:注册表清单与已登记采样器,都不落实 meta 对象
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      const sampler = getPathSampler(key)
      if (!sampler) {
        throw new AgentApiError(
          'INVALID_STATE',
          `路径已登记但尚未挂载,无法采样: ${args.pathId}`,
          {details: {objectId: args.pathId}},
        )
      }
      const out = new Vector3()
      const u = Math.min(1, Math.max(0, args.u))
      if (!sampler(u, out)) {
        throw new AgentApiError(
          'INVALID_STATE',
          `路径没有控制点,无法采样: ${args.pathId}`,
          {details: {objectId: args.pathId}},
        )
      }
      return {position: {x: out.x, y: out.y, z: out.z}}
    },
  })

  // —— 路径编辑会话(session 域,不进项目历史)——

  registry.register<{pathId: string}, void>({
    name: 'paths.session.startEditing',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {pathId: pathIdProperty},
      required: ['pathId'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => ({
      pathId: requireString(requireObject(value), 'pathId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      requireHandler(runtime, 'startPathEditing')({pathKey: key})
    },
  })

  registry.register<Record<string, unknown>, void>({
    name: 'paths.session.exitEditing',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {type: 'object', additionalProperties: false},
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: (value) =>
      value === undefined || value === null ? {} : requireObject(value),
    execute: async () => {
      runtime.assertActive()
      requireHandler(runtime, 'exitPathEditing')()
      // 点选择随编辑态一并清掉:与 selection.clear 同一个 runtime
      // 清理函数(未绑定时静默跳过,同 selection.clear)
      runtime.handlers.clearPathPointSelection?.()
    },
  })

  registry.register<{pathId: string; pointKey: string}, void>({
    name: 'paths.session.selectPoint',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        pathId: pathIdProperty,
        pointKey: {type: 'string', description: '控制点 key,如 P2'},
      },
      required: ['pathId', 'pointKey'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'PATH_POINT_NOT_FOUND',
      'INVALID_STATE',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        pathId: requireString(args, 'pathId'),
        pointKey: requireString(args, 'pointKey'),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const key = resolveRegisteredPathKey(runtime.sheet, args.pathId)
      const getState = requireHandler(runtime, 'getPathEditingState')
      if (getState().pathKey !== key) {
        throw new AgentApiError(
          'INVALID_STATE',
          `路径未在编辑,先 paths.session.startEditing: ${args.pathId}`,
          {details: {objectId: args.pathId}},
        )
      }
      // 点存在性:先探测对象(不创建),再读名单
      if (!pathExists(runtime.sheet, key)) {
        throw new AgentApiError(
          'INVALID_STATE',
          `路径已登记但对象未挂载,无法选点: ${args.pathId}`,
          {details: {objectId: args.pathId}},
        )
      }
      if (
        !readPathPoints(runtime.sheet, key).some((e) => e.key === args.pointKey)
      ) {
        throw new AgentApiError(
          'PATH_POINT_NOT_FOUND',
          `路径 ${key} 没有控制点 ${args.pointKey}`,
          {details: {pathKey: key, pointKey: args.pointKey}},
        )
      }
      requireHandler(
        runtime,
        'selectPathPoint',
      )({
        pathKey: key,
        pointKey: args.pointKey,
      })
    },
  })
}
