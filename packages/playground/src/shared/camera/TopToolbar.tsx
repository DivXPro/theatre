/**
 * 顶栏工具条:只放全局动作——添加模型、添加路径(各弹各的框体)、添加
 * 相机、导出视频。姿势/动作绑定具体物体,入口在右键模型的菜单里;物体
 * 的属性设置在各自面板(见 docs/superpowers/specs/2026-09-12-asset-library-split-design.md)。
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
  onToggleModelLibrary,
  onTogglePathLibrary,
  onAddCamera,
  exportSinks,
  exporting,
  exportDisabled,
  onPickExportSink,
  onStopExport,
  pipVisible,
  onTogglePip,
  pipDisabled = false,
  libraryDisabled = false,
}: {
  onToggleModelLibrary: () => void
  onTogglePathLibrary: () => void
  onAddCamera: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
  /** 画中画开关:开时按钮带高亮(和小窗边框同色) */
  pipVisible: boolean
  onTogglePip: () => void
  /** 没有活动相机时置灰(小窗本来也不存在) */
  pipDisabled?: boolean
  /** 放置中/拖拽中禁用添加入口,避免再开一次放置流程 */
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
        onClick={onToggleModelLibrary}
        style={buttonStyle(libraryDisabled)}
        title={libraryDisabled ? '放置中:先确认或取消当前放置' : undefined}
      >
        添加模型
      </button>
      <button
        disabled={libraryDisabled}
        onClick={onTogglePathLibrary}
        style={buttonStyle(libraryDisabled)}
        title={libraryDisabled ? '放置中:先确认或取消当前放置' : undefined}
      >
        添加路径
      </button>
      <button
        onClick={onAddCamera}
        style={buttonStyle(false)}
        title="从当前导演视角创建一台相机(落地即活动相机)"
      >
        添加相机
      </button>
      <button
        onClick={onTogglePip}
        disabled={pipDisabled}
        style={{
          ...buttonStyle(pipDisabled),
          // 开启态高亮:和画中画小窗的边框同色
          ...(pipVisible && !pipDisabled
            ? {borderColor: '#6fb7ff', color: '#6fb7ff'}
            : {}),
        }}
        title={
          pipDisabled
            ? '先添加相机'
            : pipVisible
              ? '隐藏右下角的镜头画中画'
              : '显示右下角的镜头画中画'
        }
      >
        画中画
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
