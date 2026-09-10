/**
 * 菜单项/面板动作的纯构建层:所有右键菜单、下拉菜单、面板动作区的内容
 * 都在这里组装成数据,组件层(App/TopToolbar/各右键挂载点)只负责渲染
 * 和接回调。纯函数,单测直接断言结构。
 */
import type {ContextMenuItem} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import type {SheetObjectActionsConfig} from '@dreamerbird/core/types/public'
import {GIZMO_MODE_LABELS} from './PlacementManager'
import type {GizmoMode} from './PlacementManager'

/** 右键相机(视锥/机身):镜头视角入口 + 删除(真删:注册表移除+持久数据清理) */
export function buildCameraMenuItems(opts: {
  onViewShot: () => void
  onDeleteCamera: () => void
}): ContextMenuItem[] {
  return [
    {type: 'normal', label: '查看此镜头', callback: opts.onViewShot},
    {type: 'separator'},
    {type: 'normal', label: '删除相机', callback: opts.onDeleteCamera},
  ]
}

export function buildPathMenuItems(opts: {
  metaKey: string
  editing: boolean
  onToggleEdit: () => void
  onDelete: () => void
}): ContextMenuItem[] {
  return [
    {
      type: 'normal',
      label: opts.editing ? '退出编辑(Tab)' : '编辑路径(Tab)',
      callback: () => opts.onToggleEdit(),
    },
    {type: 'separator'},
    {
      type: 'normal',
      label: '删除路径',
      callback: () => opts.onDelete(),
    },
  ]
}

export function buildObjectMenuItems(opts: {
  mode: GizmoMode
  onSelectMode: (mode: GizmoMode) => void
  onDelete: () => void
}): ContextMenuItem[] {
  const modes: Array<GizmoMode> = ['translate', 'rotate', 'scale']
  return [
    ...modes.map(
      (m): ContextMenuItem => ({
        type: 'normal',
        // 无前导图标位,用全角空格对齐文字
        label: `${m === opts.mode ? '✓' : '　'}${GIZMO_MODE_LABELS[m]}`,
        callback: () => opts.onSelectMode(m),
      }),
    ),
    {type: 'separator'},
    {type: 'normal', label: '删除', callback: () => opts.onDelete()},
  ]
}

export function buildCameraPanelActions(opts: {
  hasPoints: boolean
  targetHidden: boolean
  onAlignToPathStart: () => void
  onRestoreTarget: () => void
}): SheetObjectActionsConfig {
  const actions: SheetObjectActionsConfig = {}
  // 空路径没有"起点"可对齐,不出按钮(actions 无 disabled 概念,用不出现表达)
  if (opts.hasPoints) {
    actions['对齐到路径起点'] = () => opts.onAlignToPathStart()
  }
  if (opts.targetHidden) {
    actions['恢复 Target'] = () => opts.onRestoreTarget()
  }
  return actions
}

export function buildPathPanelActions(opts: {
  hasPoints: boolean
  onMovePathToCamera: () => void
}): SheetObjectActionsConfig {
  if (!opts.hasPoints) return {}
  return {['路径平移到相机']: () => opts.onMovePathToCamera()}
}

export function buildExportMenuItems<S extends {label: string}>(
  sinks: readonly S[],
  onPick: (sink: S) => void,
): ContextMenuItem[] {
  return sinks.map((sink) => ({
    type: 'normal',
    label: sink.label,
    callback: () => onPick(sink),
  }))
}
