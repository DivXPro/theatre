// packages/playground/src/shared/camera/pickerRegistry.ts
/**
 * 选择框体注册表(2026-10-01):宿主应用把自己的选择框体组件注册进来,
 * 替换库内置框体。目前两个槽位:
 * - 'pose':属性面板姿势行点值弹出的姿势选择框(内置 = PosePickerFrame)
 * - 'model':顶栏「添加模型」弹出的模型选择框(内置 = AssetLibraryPanel)
 *
 * 库负责打开/关闭时机与数据组装,宿主组件经 props 拿数据、调回调完成
 * 选择;不注册 = 内置框体,零回归。与 App 的 onOpenModelPicker 接管回调
 * 共存:回调 = 完全不弹内置框(宿主全自控);注册 = 框体照弹、内芯换宿主。
 *
 * 注册时机:宿主应用启动时(App 挂载前后均可)调一次注册即可——每次打开
 * 框体都现读注册表,无需订阅;卸载/热更对称调 unregister。
 */
import type React from 'react'
import type {
  PoseCurrentKey,
  PoseOption,
  PoseOptionKey,
} from './poseMode/poseOptions'
import type {ModelEntry} from './assetLibrary/types'

/** 姿势选择框体 props:选项已组装(T 姿势卡/骨架族过滤/缺失卡),宿主只画 UI */
export type PosePickerProps = {
  options: PoseOption[]
  current: PoseCurrentKey
  /** 选中一项:写值(打帧/撤销语义与内置一致)并关框,由库内完成 */
  onPick: (key: PoseOptionKey) => void
  onClose: () => void
}

/** 模型选择框体 props:清单/缩略图/放置/导入全由库喂,宿主只画 UI */
export type ModelPickerProps = {
  entries: ModelEntry[]
  /** 缩略图 blob URL(懒加载;无缩略图或加载中返回 undefined) */
  getThumbUrl: (entry: ModelEntry) => string | undefined
  /** 点选放置:进画布放置模式(幽灵跟随,点画布落定) */
  onPlace: (entry: ModelEntry) => void
  /** 拖拽放置起点:宿主卡片按下并越过拖拽阈值时调,进放置幽灵 */
  onDragStart: (entry: ModelEntry) => void
  /** 上传外部模型文件入库,返回正式条目 */
  onImport: (file: File) => Promise<ModelEntry>
  onClose: () => void
}

type PickerComponentMap = {
  pose: React.FC<PosePickerProps>
  model: React.FC<ModelPickerProps>
}

const registry = new Map<keyof PickerComponentMap, React.ComponentType<any>>()

export function registerPosePicker(component: React.FC<PosePickerProps>): void {
  registry.set('pose', component)
}
export function unregisterPosePicker(): void {
  registry.delete('pose')
}
export function registerModelPicker(
  component: React.FC<ModelPickerProps>,
): void {
  registry.set('model', component)
}
export function unregisterModelPicker(): void {
  registry.delete('model')
}

/** 读当前注册的框体组件;未注册返回 undefined(调用方回退内置框体) */
export function getRegisteredPicker<K extends keyof PickerComponentMap>(
  kind: K,
): PickerComponentMap[K] | undefined {
  return registry.get(kind) as PickerComponentMap[K] | undefined
}
