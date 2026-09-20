/**
 * 顶栏工具条:只放全局动作——添加模型、添加路径(各弹各的框体)、添加
 * 相机、画中画、导出视频。姿势/动作绑定具体物体,入口在右键模型的菜单里;
 * 物体的属性设置在各自面板(见 docs/superpowers/specs/2026-09-12-asset-library-split-design.md)。
 *
 * 外观 = studio 原生工具条:连体容器(ToolbarSwitchSelectContainer)+
 * 图标按钮(ToolbarIconButton),图标+hover tooltip。chordial 挂在 studio
 * 的 shadow DOM 里(这里用不了),tooltip 是自实现的,样式照抄 BasicTooltip。
 * --theatre-* 令牌定义在 studio 的 :host(shadow DOM),主文档不可见,
 * 一律带同值兜底——令牌将来全局化时自动接管。
 */
import React, {useCallback, useRef} from 'react'
import styled from 'styled-components'
import ToolbarIconButton from '@dreamerbird/studio/uiComponents/toolbar/ToolbarIconButton'
import ToolbarSwitchSelectContainer from '@dreamerbird/studio/uiComponents/toolbar/ToolbarSwitchSelectContainer'
import Cube from '@dreamerbird/studio/uiComponents/icons/Cube'
import Camera from '@dreamerbird/studio/uiComponents/icons/Camera'
import useMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useMenu'
import {useT} from '@dreamerbird/studio/i18n'
import {buildExportMenuItems} from './menuModel'
import type {ExportSink} from './videoExport/sinks'

// ---------------------------------------------------------------------------
// studio 图标包里没有的三个:路径 / 画中画 / 导出 / 停止。16×16、
// currentColor,风格对齐 studio 图标

const PathIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M2.5 12.5C5 4.5 11 4.5 13.5 12.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <circle cx="2.5" cy="12.5" r="1.6" fill="currentColor" />
    <circle cx="13.5" cy="12.5" r="1.6" fill="currentColor" />
    <circle cx="8" cy="6.5" r="1.3" fill="currentColor" />
  </svg>
)

const PipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect
      x="1.5"
      y="3"
      width="13"
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <rect x="8.5" y="8" width="4.5" height="3.5" rx="0.8" fill="currentColor" />
  </svg>
)

const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 2.5v6.5M4.8 6.6L8 9.8l3.2-3.2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
)

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" />
  </svg>
)

// ---------------------------------------------------------------------------

const Positioning = styled.div`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
`

/** 原生 ToolbarIconButton + 本页需要的两个变体:禁用置灰、导出中转红 */
const Btn = styled(ToolbarIconButton)`
  &:disabled {
    opacity: 0.45;
    cursor: default;
    &:hover {
      background: var(--theatre-panel-bg-80, rgba(40, 43, 47, 0.8));
    }
  }
  &.danger {
    color: #ff7a7a;
  }
  /* 画中画开启态:沿用原生 selected 高亮,颜色对齐小窗边框 */
  &.selected {
    color: #6fb7ff;
    border-bottom-color: #6fb7ff;
  }

  /* tooltip:样式照抄 studio BasicTooltip;按钮 relative,气泡钉在正下方 */
  & > .tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    padding: 6px 8px;
    border-radius: 4px;
    box-shadow: rgb(0 0 0 / 25%) 0px 2px 4px;
    backdrop-filter: blur(8px) saturate(300%) contrast(65%) brightness(55%);
    background-color: rgb(45 46 66 / 50%);
    border: 0.5px solid rgb(86 100 110 / 46%);
    color: var(--theatre-text-primary, #ffffff);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.5;
    white-space: nowrap;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.15s ease 0.25s,
      visibility 0.15s ease 0.25s;
    .hint {
      display: block;
      color: var(--theatre-text-secondary, #cccccc);
    }
  }
  &:hover > .tip {
    opacity: 1;
    visibility: visible;
  }
`

function ToolbarBtn({
  tip,
  hint,
  children,
  ...props
}: {
  /** tooltip 第一行:动作名 */
  tip: string
  /** tooltip 第二行:补充说明/禁用原因(可空) */
  hint?: string
  children: React.ReactNode
} & React.ComponentProps<typeof Btn>) {
  return (
    <Btn {...props}>
      {children}
      <span className="tip">
        {tip}
        {hint ? <span className="hint">{hint}</span> : null}
      </span>
    </Btn>
  )
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
  const t = useT()
  const exportMenuItems = useCallback(
    () => buildExportMenuItems(exportSinks, (sink) => onPickExportSink(sink)),
    [exportSinks, onPickExportSink],
  )
  const [exportMenuNode, openExportMenu] = useMenu({items: exportMenuItems})

  return (
    <Positioning>
      <ToolbarSwitchSelectContainer>
        <ToolbarBtn
          disabled={libraryDisabled}
          onClick={onToggleModelLibrary}
          tip={t('pg.toolbar.addModel')}
          hint={
            libraryDisabled
              ? t('pg.toolbar.placing')
              : t('pg.toolbar.addModel.hint')
          }
        >
          <Cube />
        </ToolbarBtn>
        <ToolbarBtn
          disabled={libraryDisabled}
          onClick={onTogglePathLibrary}
          tip={t('pg.toolbar.addPath')}
          hint={
            libraryDisabled
              ? t('pg.toolbar.placing')
              : t('pg.toolbar.addPath.hint')
          }
        >
          <PathIcon />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={onAddCamera}
          tip={t('pg.toolbar.addCamera')}
          hint={t('pg.toolbar.addCamera.hint')}
        >
          <Camera />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={onTogglePip}
          disabled={pipDisabled}
          className={pipVisible && !pipDisabled ? 'selected' : undefined}
          tip={t('pg.toolbar.pip')}
          hint={
            pipDisabled
              ? t('pg.toolbar.pip.disabled')
              : pipVisible
                ? t('pg.toolbar.pip.hide')
                : t('pg.toolbar.pip.show')
          }
        >
          <PipIcon />
        </ToolbarBtn>
        <ToolbarBtn
          ref={exportButtonRef}
          disabled={exportDisabled && !exporting}
          className={exporting ? 'danger' : undefined}
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
          tip={exporting ? t('pg.toolbar.stopExport') : t('pg.toolbar.export')}
          hint={
            exporting
              ? t('pg.toolbar.export.esc')
              : exportDisabled
                ? t('pg.toolbar.pip.disabled')
                : t('pg.toolbar.export.hint')
          }
        >
          {exporting ? <StopIcon /> : <ExportIcon />}
        </ToolbarBtn>
      </ToolbarSwitchSelectContainer>
      {exportMenuNode}
    </Positioning>
  )
}
