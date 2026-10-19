/**
 * view 命令(2026-10-17,Task 12):getState / setShotView / setPipVisible /
 * orbit / pan / dolly / reset。
 *
 * 全部 session 域、undoable:none(spec 9 view 行 + 8.6.4:视图/UI 会话
 * 操作不进撤销历史)。视图会话态(活动相机、镜头视角、PIP、路径编辑、
 * gizmo 模式)经 Scene Runtime handler 读写 CameraScene 会话状态(生产
 * 绑定属 Task 15;未绑定 SCENE_UNAVAILABLE),studio 显隐读公开
 * studio.ui.isHidden。orbit/pan/dolly/reset 转发到 directorView 模块
 * 注册的导演控制器(MainOrbitControls 挂载时登记;未注册 API_NOT_READY,
 * 不静默成功),参数必须是有限数字。
 */
import type {IStudio} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getDirectorView} from '../runtime/directorView'
import type {JsonSchema} from '../types'
import {requireBoolean, requireFiniteNumber, requireObject} from '../validation'
import type {GizmoMode} from '../../PlacementManager'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 读取视图会话态(CameraScene 绑定):活动相机 key(无则 null)、
     * 镜头视角开关、PIP 可见性、正在编辑的路径 key(无则 null)、
     * gizmo 模式。只读会话状态,不碰 Theatre 对象。
     */
    getViewState(): {
      activeCameraKey: string | null
      shotView: boolean
      pipVisible: boolean
      editingPath: string | null
      gizmoMode: GizmoMode
    }
    /** 开关镜头视角(CameraScene 绑定,转发 setShotView) */
    setShotView(args: {on: boolean}): void
    /** 开关画中画(CameraScene 绑定,转发 setPipVisible) */
    setPipVisible(args: {visible: boolean}): void
  }
}

/** 视图会话状态(view.getState 的输出) */
export type ViewState = {
  activeCameraKey: string | null
  shotView: boolean
  pipVisible: boolean
  editingPath: string | null
  gizmoMode: GizmoMode
  /** studio UI 整体隐藏态(公开 studio.ui.isHidden) */
  studioHidden: boolean
}

/** 视图门面(Task 15 由同名命令转发实现) */
export type ViewApi = {
  getState(): Promise<ViewState>
  setShotView(args: {on: boolean}): Promise<void>
  setPipVisible(args: {visible: boolean}): Promise<void>
  orbit(args: {deltaTheta: number; deltaPhi: number}): Promise<void>
  pan(args: {deltaX: number; deltaY: number}): Promise<void>
  dolly(args: {delta: number}): Promise<void>
  reset(): Promise<void>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}
const voidOutput: JsonSchema = {type: 'object', additionalProperties: false}

const getStateOutput: JsonSchema = {
  type: 'object',
  properties: {
    activeCameraKey: {
      type: 'string',
      description: '活动相机 key;无活动相机为 null',
    },
    shotView: {type: 'boolean'},
    pipVisible: {type: 'boolean'},
    editingPath: {
      type: 'string',
      description: '正在编辑的路径 key;未编辑为 null',
    },
    gizmoMode: {
      type: 'string',
      enum: ['select', 'translate', 'rotate', 'scale'],
    },
    studioHidden: {type: 'boolean'},
  },
  required: [
    'activeCameraKey',
    'shotView',
    'pipVisible',
    'editingPath',
    'gizmoMode',
    'studioHidden',
  ],
}

function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
}

function requireStudio(runtime: AgentRuntime): IStudio {
  const studio = runtime.getStudio()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用')
  }
  return studio
}

/** 已注册的导演控制器;未注册 API_NOT_READY(MainOrbitControls 未挂载) */
function requireDirectorView() {
  const controller = getDirectorView()
  if (!controller) {
    throw new AgentApiError(
      'API_NOT_READY',
      '导演视角控制器未注册(场景轨道控制器尚未挂载)',
    )
  }
  return controller
}

function requireViewHandlers(runtime: AgentRuntime) {
  const handlers = runtime.handlers
  if (
    !handlers.getViewState ||
    !handlers.setShotView ||
    !handlers.setPipVisible
  ) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Scene Runtime 未绑定视图 handler,无法读写视图会话态',
    )
  }
  return handlers as Required<
    Pick<typeof handlers, 'getViewState' | 'setShotView' | 'setPipVisible'>
  >
}

export function registerViewCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<Record<string, unknown>, ViewState>({
    name: 'view.getState',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: getStateOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      const handlers = requireViewHandlers(runtime)
      const studio = requireStudio(runtime)
      return {...handlers.getViewState(), studioHidden: studio.ui.isHidden}
    },
  })

  registry.register<{on: boolean}, void>({
    name: 'view.setShotView',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        on: {
          type: 'boolean',
          description: 'true = 进入镜头视角,false = 回到导演视角',
        },
      },
      required: ['on'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: (value) => ({on: requireBoolean(requireObject(value), 'on')}),
    execute: async (args) => {
      runtime.assertActive()
      requireViewHandlers(runtime).setShotView({on: args.on})
    },
  })

  registry.register<{visible: boolean}, void>({
    name: 'view.setPipVisible',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        visible: {type: 'boolean', description: '画中画是否可见'},
      },
      required: ['visible'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: (value) => ({
      visible: requireBoolean(requireObject(value), 'visible'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      requireViewHandlers(runtime).setPipVisible({visible: args.visible})
    },
  })

  registry.register<{deltaTheta: number; deltaPhi: number}, void>({
    name: 'view.orbit',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        deltaTheta: {
          type: 'number',
          description: '方位角增量(弧度,正值绕瞄准点逆时针,俯视)',
        },
        deltaPhi: {
          type: 'number',
          description: '极角增量(弧度,正值向水平方向下压)',
        },
      },
      required: ['deltaTheta', 'deltaPhi'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'API_NOT_READY'],
    validate: (value) => {
      const args = requireObject(value)
      return {
        deltaTheta: requireFiniteNumber(args.deltaTheta, 'deltaTheta'),
        deltaPhi: requireFiniteNumber(args.deltaPhi, 'deltaPhi'),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      requireDirectorView().orbit(args)
    },
  })

  registry.register<{deltaX: number; deltaY: number}, void>({
    name: 'view.pan',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        deltaX: {type: 'number', description: '沿相机右方向平移(世界单位)'},
        deltaY: {type: 'number', description: '沿相机上方向平移(世界单位)'},
      },
      required: ['deltaX', 'deltaY'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'API_NOT_READY'],
    validate: (value) => {
      const args = requireObject(value)
      return {
        deltaX: requireFiniteNumber(args.deltaX, 'deltaX'),
        deltaY: requireFiniteNumber(args.deltaY, 'deltaY'),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      requireDirectorView().pan(args)
    },
  })

  registry.register<{delta: number}, void>({
    name: 'view.dolly',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        delta: {
          type: 'number',
          description: '沿视线的距离增量(正值 = 靠近瞄准点,负值 = 拉远)',
        },
      },
      required: ['delta'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'API_NOT_READY'],
    validate: (value) => ({
      delta: requireFiniteNumber(requireObject(value).delta, 'delta'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      requireDirectorView().dolly(args)
    },
  })

  registry.register<Record<string, unknown>, void>({
    name: 'view.reset',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'API_NOT_READY'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      requireDirectorView().reset()
    },
  })
}
