/**
 * 顶栏工具条:三组连体按钮,组间留空——
 *   [选择|移动|旋转|缩放] 变换模式(互斥单选,和 W/G/R/S 快捷键、对象
 *     右键菜单共用 useGizmoMode 的 state;选择模式下只点选不挂手柄;
 *     无选中对象时也可先设好模式)
 *   [添加模型|添加路径|添加相机|添加锚点] 各弹各的框体
 *   [画中画|导出视频] 输出
 * 姿势/动作绑定具体物体,入口在右键模型的菜单里;物体的属性设置在各自
 * 面板(见 docs/superpowers/specs/2026-09-12-asset-library-split-design.md)。
 *
 * 外观 = studio 原生工具条:连体容器(ToolbarSwitchSelectContainer)+
 * 图标按钮(ToolbarIconButton),图标+hover tooltip。chordial 挂在 studio
 * 的 shadow DOM 里(这里用不了),tooltip 是自实现的,样式照抄 BasicTooltip。
 * 图标全部来自 @phosphor-icons/react(studio 图标包本来就是 phosphor
 * 手移植,这里直接用库,风格天然一致)。
 * --theatre-* 令牌定义在 studio 的 :host(shadow DOM),主文档不可见,
 * 一律带同值兜底——令牌将来全局化时自动接管。
 */
import React, {useCallback, useRef} from 'react'
import styled from 'styled-components'
import {
  ArrowClockwise,
  ArrowsOut,
  ArrowsOutCardinal,
  Camera,
  Crosshair,
  Cube,
  Cursor,
  Export,
  Path,
  PictureInPicture,
  Stop,
} from '@phosphor-icons/react'
import ToolbarIconButton from '@dreamerbird/studio/uiComponents/toolbar/ToolbarIconButton'
import ToolbarSwitchSelectContainer from '@dreamerbird/studio/uiComponents/toolbar/ToolbarSwitchSelectContainer'
import useMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/useMenu'
import {useT} from '@dreamerbird/studio/i18n'
import {buildExportMenuItems} from './menuModel'
import type {ExportSink} from './videoExport/sinks'
import type {GizmoMode} from './PlacementManager'

// ---------------------------------------------------------------------------

const Positioning = styled.div`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  gap: 8px;
  align-items: flex-start;
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

/** 画中画开启态:沿用原生 selected 高亮,颜色对齐小窗边框 */
const PipBtn = styled(Btn)`
  &.selected {
    color: #6fb7ff;
    border-bottom-color: #6fb7ff;
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

const GIZMO_MODES: ReadonlyArray<{
  mode: GizmoMode
  tipKey: string
  hintKey: string
  Icon: typeof ArrowsOutCardinal
}> = [
  {
    mode: 'select',
    tipKey: 'pg.gizmo.select',
    hintKey: 'pg.gizmo.select.hint',
    Icon: Cursor,
  },
  {
    mode: 'translate',
    tipKey: 'pg.gizmo.translate',
    hintKey: 'pg.gizmo.translate.hint',
    Icon: ArrowsOutCardinal,
  },
  {
    mode: 'rotate',
    tipKey: 'pg.gizmo.rotate',
    hintKey: 'pg.gizmo.rotate.hint',
    Icon: ArrowClockwise,
  },
  {
    mode: 'scale',
    tipKey: 'pg.gizmo.scale',
    hintKey: 'pg.gizmo.scale.hint',
    Icon: ArrowsOut,
  },
]

export function TopToolbar({
  gizmoMode,
  onSelectGizmoMode,
  onToggleModelLibrary,
  onTogglePathLibrary,
  onAddCamera,
  onAddAnchor,
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
  /** 变换模式组的当前模式,与 G/R/S 快捷键、对象右键菜单同源 */
  gizmoMode: GizmoMode
  onSelectGizmoMode: (mode: GizmoMode) => void
  onToggleModelLibrary: () => void
  onTogglePathLibrary: () => void
  onAddCamera: () => void
  onAddAnchor: () => void
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
        {GIZMO_MODES.map(({mode, tipKey, hintKey, Icon}) => (
          <ToolbarBtn
            key={mode}
            className={gizmoMode === mode ? 'selected' : undefined}
            onClick={() => onSelectGizmoMode(mode)}
            tip={t(tipKey)}
            hint={t(hintKey)}
          >
            <Icon size={16} />
          </ToolbarBtn>
        ))}
      </ToolbarSwitchSelectContainer>
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
          <Cube size={16} />
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
          <Path size={16} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={onAddCamera}
          tip={t('pg.toolbar.addCamera')}
          hint={t('pg.toolbar.addCamera.hint')}
        >
          <Camera size={16} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={onAddAnchor}
          tip={t('pg.toolbar.addAnchor')}
          hint={t('pg.toolbar.addAnchor.hint')}
        >
          <Crosshair size={16} />
        </ToolbarBtn>
      </ToolbarSwitchSelectContainer>
      <ToolbarSwitchSelectContainer>
        <ToolbarBtn
          as={PipBtn}
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
          <PictureInPicture size={16} />
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
          {exporting ? <Stop size={16} /> : <Export size={16} />}
        </ToolbarBtn>
      </ToolbarSwitchSelectContainer>
      {exportMenuNode}
    </Positioning>
  )
}
