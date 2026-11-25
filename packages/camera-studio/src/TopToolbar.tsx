/**
 * 工作台顶部工具条:变换、添加、渲染和输出操作。
 *   [选择|移动|旋转|缩放] 变换模式(互斥单选,和 W/G/R/S 快捷键、对象
 *     右键菜单共用 useGizmoMode 的 state;选择模式下只点选不挂手柄;
 *     无选中对象时也可先设好模式)
 *   [添加模型|添加路径|添加相机|添加锚点] 各弹各的框体
 *   [漫画模式开关|人物名称] 视口显示
 *   [画中画|导出视频] 输出
 * 姿势/动作绑定具体物体,入口在右键模型的菜单里;物体的属性设置在各自
 * 面板(见 docs/superpowers/specs/2026-09-12-asset-library-split-design.md)。
 *
 * 图标使用 Phosphor，样式见 styles/chrome.css。
 */
import React, {useCallback, useRef} from 'react'
import {
  ArrowClockwise,
  ArrowsOut,
  ArrowsOutCardinal,
  BookOpenText,
  Camera,
  Crosshair,
  Cube,
  Cursor,
  Export,
  Image,
  IdentificationBadge,
  Path,
  PictureInPicture,
  Stop,
  SignOut,
} from '@phosphor-icons/react'
import {useMenu} from '@dreamerbird/studio/camera-studio'
import {useT} from '@dreamerbird/studio/i18n'
import {buildExportMenuItems} from './menuModel'
import type {ExportSink} from './videoExport/sinks'
import type {GizmoMode} from './PlacementManager'
import type {ViewportRenderMode} from './mangaViewport'

function ToolbarBtn({
  tip,
  hint,
  children,
  className,
  ...props
}: {
  /** tooltip 第一行:动作名 */
  tip: string
  /** tooltip 第二行:补充说明/禁用原因(可空) */
  hint?: string
  children: React.ReactNode
} & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={tip}
      className={['cs-toolbar-button cs-tooltip-trigger', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
      <span className="tip">
        {tip}
        {hint ? <span className="hint">{hint}</span> : null}
      </span>
    </button>
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
  renderMode,
  onSelectRenderMode,
  characterNamesVisible,
  onToggleCharacterNames,
  onToggleModelLibrary,
  onTogglePathLibrary,
  onAddCamera,
  onAddAnchor,
  exportSinks,
  exporting,
  exportDisabled,
  onExportImage,
  onExportVideo,
  onPickExportSink,
  onStopExport,
  pipVisible,
  onTogglePip,
  pipDisabled = false,
  libraryDisabled = false,
  headerActions,
  onCloseScene,
}: {
  /** 变换模式组的当前模式,与 G/R/S 快捷键、对象右键菜单同源 */
  gizmoMode: GizmoMode
  onSelectGizmoMode: (mode: GizmoMode) => void
  renderMode: ViewportRenderMode
  onSelectRenderMode: (mode: ViewportRenderMode) => void
  characterNamesVisible: boolean
  onToggleCharacterNames: () => void
  onToggleModelLibrary: () => void
  onTogglePathLibrary: () => void
  onAddCamera: () => void
  onAddAnchor: () => void
  exportSinks: readonly ExportSink[]
  exporting: boolean
  exportDisabled: boolean
  onExportImage: () => void
  onExportVideo?: () => void
  onPickExportSink: (sink: ExportSink) => void
  onStopExport: () => void
  /** 画中画开关:开时按钮带高亮(和小窗边框同色) */
  pipVisible: boolean
  onTogglePip: () => void
  /** 没有活动相机时置灰(小窗本来也不存在) */
  pipDisabled?: boolean
  /** 放置中/拖拽中禁用添加入口,避免再开一次放置流程 */
  libraryDisabled?: boolean
  headerActions?: React.ReactNode
  onCloseScene?: () => void
}) {
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const t = useT()
  const exportMenuItems = useCallback(
    () => buildExportMenuItems(exportSinks, (sink) => onPickExportSink(sink)),
    [exportSinks, onPickExportSink],
  )
  const [exportMenuNode, openExportMenu] = useMenu({items: exportMenuItems})
  const mangaEnabled = renderMode !== 'original'
  const characterNamesLabel = t('pg.toolbar.characterNames')

  return (
    <div className="cs-toolbar-position">
      <div
        className="cs-toolbar-bar"
        role="toolbar"
        aria-label={t('pg.toolbar.actions')}
      >
        <div
          className="cs-toolbar-tray"
          role="group"
          aria-label={t('pg.toolbar.editing')}
        >
          <div className="cs-toolbar-group">
            {GIZMO_MODES.map(({mode, tipKey, hintKey, Icon}) => (
              <ToolbarBtn
                key={mode}
                className={gizmoMode === mode ? 'selected' : undefined}
                aria-pressed={gizmoMode === mode}
                onClick={() => onSelectGizmoMode(mode)}
                tip={t(tipKey)}
                hint={t(hintKey)}
              >
                <Icon size={18} />
              </ToolbarBtn>
            ))}
          </div>
          <div className="cs-toolbar-group">
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
              <Cube size={18} />
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
              <Path size={18} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={onAddCamera}
              tip={t('pg.toolbar.addCamera')}
              hint={t('pg.toolbar.addCamera.hint')}
            >
              <Camera size={18} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={onAddAnchor}
              tip={t('pg.toolbar.addAnchor')}
              hint={t('pg.toolbar.addAnchor.hint')}
            >
              <Crosshair size={18} />
            </ToolbarBtn>
          </div>
          <div
            className="cs-toolbar-group"
            role="group"
            aria-label={t('pg.toolbar.render')}
          >
            <ToolbarBtn
              role="switch"
              aria-label={t('pg.toolbar.render.manga')}
              aria-checked={mangaEnabled}
              className={mangaEnabled ? 'selected' : undefined}
              onClick={() =>
                onSelectRenderMode(mangaEnabled ? 'original' : 'line')
              }
              tip={t('pg.toolbar.render.manga')}
              hint={t('pg.toolbar.render.manga.hint')}
            >
              <BookOpenText size={18} aria-hidden />
            </ToolbarBtn>
            <ToolbarBtn
              role="switch"
              aria-checked={characterNamesVisible}
              className={characterNamesVisible ? 'selected' : undefined}
              onClick={onToggleCharacterNames}
              tip={characterNamesLabel}
            >
              <IdentificationBadge size={18} />
            </ToolbarBtn>
          </div>
        </div>
        <div
          className="cs-toolbar-tray"
          role="group"
          aria-label={t('pg.toolbar.output')}
        >
          <div className="cs-toolbar-group">
            <ToolbarBtn
              onClick={onTogglePip}
              disabled={pipDisabled}
              aria-pressed={pipVisible && !pipDisabled}
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
              <PictureInPicture size={18} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={onExportImage}
              disabled={exportDisabled || exporting}
              tip={t('pg.toolbar.exportImage')}
              hint={
                pipDisabled
                  ? t('pg.toolbar.pip.disabled')
                  : t('pg.toolbar.exportImage.hint')
              }
            >
              <Image size={18} />
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
                if (onExportVideo) {
                  onExportVideo()
                  return
                }
                const rect = exportButtonRef.current?.getBoundingClientRect()
                openExportMenu(
                  rect
                    ? {clientX: rect.left, clientY: rect.bottom + 4}
                    : undefined,
                )
              }}
              tip={
                exporting ? t('pg.toolbar.stopExport') : t('pg.toolbar.export')
              }
              hint={
                exporting
                  ? t('pg.toolbar.export.esc')
                  : pipDisabled
                    ? t('pg.toolbar.pip.disabled')
                    : t('pg.toolbar.export.hint')
              }
            >
              {exporting ? <Stop size={18} /> : <Export size={18} />}
            </ToolbarBtn>
          </div>
          {onCloseScene && (
            <div className="cs-toolbar-group">
              <ToolbarBtn
                onClick={onCloseScene}
                tip={t('pg.toolbar.closeScene')}
              >
                <SignOut size={18} />
              </ToolbarBtn>
            </div>
          )}
          {headerActions && (
            <div className="cs-toolbar-group">{headerActions}</div>
          )}
        </div>
      </div>
      {exportMenuNode}
    </div>
  )
}
