// packages/camera-studio/src/poseMode/PosePickerFrame.tsx
/**
 * 内置姿势选择框体(2026-10-01):左侧停靠卡片框,与模型选择框体同形态
 * (视觉常量对齐 AssetLibraryPanel)。这是 PosePickerProps 的参考实现——
 * 宿主经 pickerRegistry 注册自己的组件后,本框体整体被替换。
 *
 * 纯选择语义:第一卡永远「T 姿势」(绑定/默认),往下是同骨架族库预设
 * (异族置灰);当前值高亮;管理功能(删除/保存姿势)留在资产库姿势页,
 * 不进本框。选项带 thumbUrl 时整框切两列网格卡(2026-10-05 起手势条目
 * 挂 QBX 预览图),全无图时维持单列名称行。
 *
 * 本组件经 portal 渲染在普通 DOM，使用 Camera Studio 预编译样式。
 *
 * Esc 分层:容器自己的 onKeyDown 关框并 stopPropagation——焦点在框内时
 * Esc 只关框,不触发姿势模式退出/其他全局 Esc 语义;焦点在框外时 Esc
 * 维持既有语义(姿势模式退出等),框不关。
 */
import React from 'react'
import {useI18n} from '@dreamerbird/studio/i18n'
import {getUiConfig} from '../uiConfig'

/**
 * 框体的宽松 props:姿势(PosePickerProps)与手势(GestureOption 组装)
 * 都结构满足——key 放宽为 string,标题可覆盖(手势框传「选择左手势」)。
 */
export type PickerFrameOption = {
  key: string
  label: string
  disabled?: boolean
  hint?: string
  /** 缩略图 URL(2026-10-05):任一选项带图则整框切两列网格卡片 */
  thumbUrl?: string
}

export type PickerFrameProps = {
  options: PickerFrameOption[]
  current: string
  onPick: (key: string) => void
  onClose: () => void
  /** 标题覆盖;缺省「姿势来源」 */
  title?: string
}

export function PosePickerFrame({
  options,
  current,
  onPick,
  onClose,
  title,
}: PickerFrameProps): React.ReactElement {
  const {t} = useI18n()
  // 任一选项带缩略图 → 两列网格卡(图上文下);全无图 → 维持单列名称行
  const hasThumbs = options.some((o) => o.thumbUrl)
  return (
    <div
      data-testid="PosePickerFrame"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      className="cs-asset-panel cs-pose-picker"
      style={{zIndex: getUiConfig().zIndexBase}}
    >
      <div className="cs-asset-head">
        <span className="cs-asset-head-title">
          {title ?? t('pg.pose.selectorTitle')}
        </span>
        <div className="cs-asset-head-spacer" />
        <button
          type="button"
          className="cs-pose-picker-close"
          aria-label={t('pg.pose.selectorClose')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {/* 选项区:有图走两列卡片,无图维持单列名称行。
          两列用 flex-wrap 不用 grid:grid 自动行高对卡片内容(图位方块)
          的测量在 Chromium 里会塌成文字行高、卡片互相叠压,显式高度也
          救不回;flex 行高按内容撑开,正常(2026-10-05 三轮实测) */}
      <div className="cs-pose-options" data-thumbs={hasThumbs ? '' : undefined}>
        {options.map((opt) => {
          const isCurrent = opt.key === current
          return (
            <div
              key={opt.key}
              className="cs-pose-option"
              data-pose-option={opt.key}
              data-current={isCurrent ? '' : undefined}
              data-disabled={opt.disabled ? '' : undefined}
              title={opt.disabled ? opt.hint?.trim() : undefined}
              onClick={() => {
                if (opt.disabled) return
                onPick(opt.key)
              }}
            >
              {hasThumbs && (
                <div className="cs-pose-option-thumb">
                  {opt.thumbUrl && (
                    <img src={opt.thumbUrl} alt="" draggable={false} />
                  )}
                </div>
              )}
              <div className="cs-pose-option-label">
                <span>{opt.label}</span>
                {opt.hint && (
                  <span className="cs-pose-option-hint">{opt.hint.trim()}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PosePickerFrame
