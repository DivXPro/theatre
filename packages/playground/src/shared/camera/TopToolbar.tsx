/**
 * 顶栏工具条:只放全局动作——添加(模型/相机/路径)和导出视频。
 * 物体的属性设置在各自面板,物体的动作在面板动作区和右键菜单,
 * 都不进这里(见 docs/superpowers/specs/2026-09-01-camera-menu-reorg-design.md)。
 * 一个 flex 容器按顺序排,不再写死像素偏移。
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
  placing,
  onOpenLibrary,
  addCameraEnabled,
  onAddCamera,
  addPathEnabled,
  onAddPath,
  exportSinks,
  exporting,
  exportDisabled,
  onPickExportSink,
  onStopExport,
}: {
  placing: boolean
  onOpenLibrary: () => void
  addCameraEnabled: boolean
  onAddCamera: () => void
  addPathEnabled: boolean
  onAddPath: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
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
        disabled={placing}
        onClick={onOpenLibrary}
        style={buttonStyle(placing)}
      >
        {placing ? '放置中:左键确认落点,Esc/右键取消' : '添加模型'}
      </button>
      <button
        disabled={!addCameraEnabled}
        onClick={onAddCamera}
        style={buttonStyle(!addCameraEnabled)}
        title={
          addCameraEnabled
            ? '从当前导演视角创建一台相机'
            : '已存在相机;多相机将在后续版本开放'
        }
      >
        添加相机
      </button>
      <button
        disabled={!addPathEnabled}
        onClick={onAddPath}
        style={buttonStyle(!addPathEnabled)}
        title={
          addPathEnabled
            ? '从当前机位播种一段环绕弧,并进入编辑模式'
            : '已存在路径;多路径将在后续版本开放'
        }
      >
        添加路径
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
