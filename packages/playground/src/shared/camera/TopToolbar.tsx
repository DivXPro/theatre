/**
 * 顶栏工具条:只放全局动作——资产库(模型/姿势/动作/路径预设的统一
 * 入口)、添加相机、导出视频。物体的属性设置在各自面板,物体的动作在
 * 面板动作区和右键菜单(见 docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md
 * 与 2026-09-12-unified-placement-panel-design.md)。
 */
import React, {useCallback, useRef} from 'react'
import useMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useMenu'
import {buildExportMenuItems} from './menuModel'
import type {ExportSink} from './videoExport/sinks'

function buttonStyle(disabled: boolean, danger = false): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid #444',
    background: disabled ? '#333' : danger ? '#633a3a' : '#272730',
    color: disabled ? '#888' : '#eee',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 13,
  }
}

export function TopToolbar({
  onToggleLibrary,
  onAddCamera,
  exportSinks,
  exporting,
  exportDisabled,
  onPickExportSink,
  onStopExport,
  libraryDisabled = false,
}: {
  onToggleLibrary: () => void
  onAddCamera: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
  /** 放置中/拖拽中禁用资产库入口,避免再开一次放置流程(沿用旧「添加模型」的置灰语义) */
  libraryDisabled?: boolean
}) {
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportMenuItems = useCallback(
    () => buildExportMenuItems(exportSinks, (sink) => onPickExportSink(sink)),
    [exportSinks, onPickExportSink],
  )
  const [exportMenuNode, openExportMenu] = useMenu({items: exportMenuItems})

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        gap: 8,
      }}
    >
      <button
        disabled={libraryDisabled}
        onClick={onToggleLibrary}
        style={buttonStyle(libraryDisabled)}
        title={libraryDisabled ? '放置中:先确认或取消当前放置' : undefined}
      >
        资产库
      </button>
      <button
        onClick={onAddCamera}
        style={buttonStyle(false)}
        title="从当前导演视角创建一台相机(落地即活动相机)"
      >
        添加相机
      </button>
      <button
        ref={exportButtonRef}
        disabled={exportDisabled && !exporting}
        onClick={() => {
          if (exporting) {
            onStopExport()
            return
          }
          const rect = exportButtonRef.current?.getBoundingClientRect()
          openExportMenu(
            rect ? {clientX: rect.left, clientY: rect.bottom + 4} : undefined,
          )
        }}
        style={buttonStyle(exportDisabled && !exporting, exporting)}
        title={
          exportDisabled && !exporting
            ? '先添加相机'
            : '把镜头取景实时录成视频:序列从头播到尾,录完自动保存'
        }
      >
        {exporting ? '停止并保存(Esc 取消)' : '导出视频'}
      </button>
      {exportMenuNode}
    </div>
  )
}
