/**
 * ui 命令(2026-10-17,Task 12):hide / restore / setLeftStripHidden /
 * openPanel / closePanel / setGizmoMode。
 *
 * 全部 session 域、undoable:none(spec 9 ui 行 + 8.6.4:视图/UI 会话
 * 操作不进撤销历史)。studio 显隐与左侧条走公开 `studio.ui` 方法
 * (IStudioUI:hide/restore/setLeftStripHidden);资产框体开合与 gizmo
 * 模式经 Scene Runtime handler 改 CameraScene 会话状态(生产绑定属
 * Task 15;未绑定 SCENE_UNAVAILABLE)。openPanel/closePanel 只接受
 * model|pose|animation|path,setGizmoMode 只接受
 * select|translate|rotate|scale。
 */
import type {IStudio} from '@dreamerbird/core'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireBoolean, requireObject, requireString} from '../validation'
import type {GizmoMode} from '../../PlacementManager'

/** 资产框体种类(与 CameraScene 的 LibraryFrameKind 同集) */
export type UiPanelKind = 'model' | 'pose' | 'animation' | 'path'

const PANEL_KINDS: readonly UiPanelKind[] = [
  'model',
  'pose',
  'animation',
  'path',
]
const GIZMO_MODES: readonly GizmoMode[] = [
  'select',
  'translate',
  'rotate',
  'scale',
]

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /** 打开资产框体(CameraScene 绑定,转发 openFrame) */
    openPanel(args: {panel: UiPanelKind}): void
    /** 关闭资产框体(CameraScene 绑定,转发 closeFrame) */
    closePanel(args: {panel: UiPanelKind}): void
    /** 切换 gizmo 模式(CameraScene 绑定,转发 useGizmoMode 的 setter) */
    setGizmoMode(args: {mode: GizmoMode}): void
  }
}

/** UI 门面(Task 15 由同名命令转发实现) */
export type UiApi = {
  hide(): Promise<void>
  restore(): Promise<void>
  setLeftStripHidden(args: {hidden: boolean}): Promise<void>
  openPanel(args: {panel: UiPanelKind}): Promise<void>
  closePanel(args: {panel: UiPanelKind}): Promise<void>
  setGizmoMode(args: {mode: GizmoMode}): Promise<void>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}
const voidOutput: JsonSchema = {type: 'object', additionalProperties: false}

const panelInput: JsonSchema = {
  type: 'object',
  properties: {
    panel: {
      type: 'string',
      enum: [...PANEL_KINDS],
      description: '资产框体:model|pose|animation|path',
    },
  },
  required: ['panel'],
  additionalProperties: false,
}

function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
}

function validatePanel(value: unknown): {panel: UiPanelKind} {
  const panel = requireString(requireObject(value), 'panel')
  if (!(PANEL_KINDS as readonly string[]).includes(panel)) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `未知面板: ${panel}(只支持 ${PANEL_KINDS.join('|')})`,
      {details: {panel}},
    )
  }
  return {panel: panel as UiPanelKind}
}

function requireStudio(runtime: AgentRuntime): IStudio {
  const studio = runtime.getStudio()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用')
  }
  return studio
}

function requireHandler<K extends 'openPanel' | 'closePanel' | 'setGizmoMode'>(
  runtime: AgentRuntime,
  key: K,
): NonNullable<AgentRuntime['handlers'][K]> {
  const handler = runtime.handlers[key]
  if (!handler) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      `Scene Runtime 未绑定 ${key},无法操作 UI`,
    )
  }
  return handler
}

export function registerUiCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<Record<string, unknown>, void>({
    name: 'ui.hide',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      requireStudio(runtime).ui.hide()
    },
  })

  registry.register<Record<string, unknown>, void>({
    name: 'ui.restore',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      requireStudio(runtime).ui.restore()
    },
  })

  registry.register<{hidden: boolean}, void>({
    name: 'ui.setLeftStripHidden',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        hidden: {type: 'boolean', description: 'true = 隐藏 studio 左侧条'},
      },
      required: ['hidden'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: (value) => ({
      hidden: requireBoolean(requireObject(value), 'hidden'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      requireStudio(runtime).ui.setLeftStripHidden(args.hidden)
    },
  })

  registry.register<{panel: UiPanelKind}, void>({
    name: 'ui.openPanel',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: panelInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: validatePanel,
    execute: async (args) => {
      runtime.assertActive()
      requireHandler(runtime, 'openPanel')({panel: args.panel})
    },
  })

  registry.register<{panel: UiPanelKind}, void>({
    name: 'ui.closePanel',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: panelInput,
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: validatePanel,
    execute: async (args) => {
      runtime.assertActive()
      requireHandler(runtime, 'closePanel')({panel: args.panel})
    },
  })

  registry.register<{mode: GizmoMode}, void>({
    name: 'ui.setGizmoMode',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: [...GIZMO_MODES],
          description: 'gizmo 模式:select|translate|rotate|scale',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'SCENE_UNAVAILABLE'],
    validate: (value) => {
      const mode = requireString(requireObject(value), 'mode')
      if (!(GIZMO_MODES as readonly string[]).includes(mode)) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `未知 gizmo 模式: ${mode}(只支持 ${GIZMO_MODES.join('|')})`,
          {details: {mode}},
        )
      }
      return {mode: mode as GizmoMode}
    },
    execute: async (args) => {
      runtime.assertActive()
      requireHandler(runtime, 'setGizmoMode')({mode: args.mode})
    },
  })
}
