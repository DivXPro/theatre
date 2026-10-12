// packages/camera-studio/src/assetLibrary/ModelPickerSlot.tsx
/**
 * 模型选择框体槽位(2026-10-01 注册制):顶栏「添加模型」弹出的框体的
 * 分派点。pickerRegistry 的 'model' 槽位注册了宿主组件就渲染宿主的
 * (props = 库条目 + 缩略图懒加载 + 放置/拖拽/导入/关闭回调),没注册
 * 回退内置 AssetLibraryPanel(kind='model')——零回归。
 *
 * 与 App 的 onOpenModelPicker 接管回调共存、两级优先:
 *   onOpenModelPicker 存在 → 完全不弹这里(宿主全自控,App 已拦);
 *   否则注册组件优先,内置兜底。
 *
 * 内置模型不再播种(2026-10-10 目录化):随包 GLB 由 StaticCatalogSource
 * 以只读目录并入聚合库,框体无论内置/宿主都能列到,无需挂载期触发。
 */
import React from 'react'
import {getRegisteredPicker} from '../pickerRegistry'
import {useLibraryEntries} from './library'
import type {ModelEntry} from './types'
import {useModelThumbUrl} from './useModelThumbUrl'
import {importModelFile} from './importModelFile'
import {AssetLibraryPanel} from './AssetLibraryPanel'

export type ModelPickerSlotProps = {
  onPlaceModel: (entry: ModelEntry) => void
  onDragStartModel: (entry: ModelEntry) => void
  disabled?: boolean
  onClose: () => void
}

export function ModelPickerSlot({
  onPlaceModel,
  onDragStartModel,
  disabled,
  onClose,
}: ModelPickerSlotProps): React.ReactElement {
  // hooks 无条件调用:注册分派只换渲染分支,不换订阅
  const entries = useLibraryEntries('model') as ModelEntry[]
  const {getThumbUrl} = useModelThumbUrl()

  // 每次开框现读注册表:宿主注册/注销无需订阅,下一次开框即生效
  const HostPicker = getRegisteredPicker('model')
  if (HostPicker) {
    return (
      <HostPicker
        entries={entries}
        getThumbUrl={getThumbUrl}
        onPlace={onPlaceModel}
        onDragStart={onDragStartModel}
        onImport={importModelFile}
        onClose={onClose}
      />
    )
  }
  return (
    <AssetLibraryPanel
      kind="model"
      onPlaceModel={onPlaceModel}
      onDragStartModel={onDragStartModel}
      disabled={disabled}
      onClose={onClose}
    />
  )
}

export default ModelPickerSlot
