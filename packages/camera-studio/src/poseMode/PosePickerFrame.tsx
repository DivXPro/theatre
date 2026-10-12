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
 * 样式全部 inline:本组件经 createPortal 从 shadow DOM 里的属性编辑器
 * 挂到 document.body,React 树上的 styled-components 上下文可能指向
 * shadow 根,样式表不可靠(与姿势弹框同款约束)。
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
      style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        width: 260,
        // studio 大纲面板的层级是 100,框体必须盖过它;基准可配(ui.zIndexBase)
        zIndex: getUiConfig().zIndexBase,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--theatre-panel-bg, #282b2f)',
        borderRight: '1px solid var(--theatre-panel-border, #1f1f1f)',
        color: 'var(--theatre-text-primary, #ffffff)',
        fontSize: 11,
        fontFamily:
          'var(--theatre-font-family, -apple-system, BlinkMacSystemFont, Segoe WPC, Segoe Editor, HelveticaNeue-Light, Ubuntu, Droid Sans, sans-serif)',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* 头部:照抄 studio 面板 TitleBar 配色(#25272b + 黑色细分隔线) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px 4px 12px',
          backgroundColor: '#25272b',
          borderBottom: '1px solid rgb(0 0 0 / 13%)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--theatre-head-title, #bbbbbb)',
          }}
        >
          {title ?? t('pg.pose.selectorTitle')}
        </span>
        <div style={{flex: 1}} />
        <button
          type="button"
          aria-label={t('pg.pose.selectorClose')}
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            padding: 0,
            border: 'none',
            borderRadius: 2,
            background: 'transparent',
            color: 'var(--theatre-text-secondary, #cccccc)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      {/* 选项区:有图走两列卡片,无图维持单列名称行。
          两列用 flex-wrap 不用 grid:grid 自动行高对卡片内容(图位方块)
          的测量在 Chromium 里会塌成文字行高、卡片互相叠压,显式高度也
          救不回;flex 行高按内容撑开,正常(2026-10-05 三轮实测) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          ...(hasThumbs
            ? {
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignContent: 'flex-start',
              }
            : {display: 'flex', flexDirection: 'column', gap: 8}),
        }}
      >
        {options.map((opt) => {
          const isCurrent = opt.key === current
          const border = `1px solid ${
            isCurrent
              ? 'rgba(125, 193, 200, 0.45)'
              : 'var(--theatre-panel-border, #1f1f1f)'
          }`
          if (hasThumbs) {
            return (
              <div
                key={opt.key}
                data-pose-option={opt.key}
                title={opt.disabled ? opt.hint?.trim() : undefined}
                onClick={() => {
                  if (opt.disabled) return
                  onPick(opt.key)
                }}
                style={{
                  // 两列:50% 减半个 gap;boxSizing 让边框不挤出换行
                  width: 'calc(50% - 4px)',
                  boxSizing: 'border-box',
                  borderRadius: 3,
                  background: isCurrent
                    ? 'rgba(125, 193, 200, 0.18)'
                    : 'rgba(0, 0, 0, 0.18)',
                  border,
                  cursor: opt.disabled ? 'default' : 'pointer',
                  opacity: opt.disabled ? 0.5 : 1,
                  overflow: 'hidden',
                }}
              >
                {/* 图位:无图(未加载完/无手势项)留深色占位,保持网格整齐。
                    高度写死 112(列宽 114 减双边框):grid 自动行高对百分比
                    padding/aspect-ratio 都算循环依赖,行会塌成文字高、卡片
                    互相叠压(2026-10-05 两轮实测),框体宽度本就固定 260 */}
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 112,
                    background: 'rgba(0, 0, 0, 0.25)',
                  }}
                >
                  {opt.thumbUrl && (
                    <img
                      src={opt.thumbUrl}
                      alt=""
                      draggable={false}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    padding: '4px 6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                  }}
                >
                  {opt.label}
                  {opt.hint && (
                    <span style={{color: 'var(--theatre-text-muted, #888888)'}}>
                      {opt.hint.trim()}
                    </span>
                  )}
                </div>
              </div>
            )
          }
          return (
            <div
              key={opt.key}
              data-pose-option={opt.key}
              title={opt.disabled ? opt.hint?.trim() : undefined}
              onClick={() => {
                if (opt.disabled) return
                onPick(opt.key)
              }}
              style={{
                padding: '10px 12px',
                borderRadius: 3,
                background: isCurrent
                  ? 'rgba(125, 193, 200, 0.18)'
                  : 'rgba(0, 0, 0, 0.18)',
                border,
                cursor: opt.disabled ? 'default' : 'pointer',
                opacity: opt.disabled ? 0.5 : 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {opt.label}
              </span>
              {opt.hint && (
                <span
                  style={{
                    color: 'var(--theatre-text-muted, #888888)',
                    flexShrink: 0,
                  }}
                >
                  {opt.hint.trim()}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PosePickerFrame
