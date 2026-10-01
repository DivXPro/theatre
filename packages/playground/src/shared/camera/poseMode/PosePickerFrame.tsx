// packages/playground/src/shared/camera/poseMode/PosePickerFrame.tsx
/**
 * 内置姿势选择框体(2026-10-01):左侧停靠卡片框,与模型选择框体同形态
 * (视觉常量对齐 AssetLibraryPanel)。这是 PosePickerProps 的参考实现——
 * 宿主经 pickerRegistry 注册自己的组件后,本框体整体被替换。
 *
 * 纯选择语义:第一卡永远「T 姿势」(绑定/默认),往下是同骨架族库预设
 * (异族置灰);当前值高亮;管理功能(删除/保存姿势)留在资产库姿势页,
 * 不进本框。姿势条目没有缩略图字段,卡片即名称卡。
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
import type {PosePickerProps} from '../pickerRegistry'

export function PosePickerFrame({
  options,
  current,
  onPick,
  onClose,
}: PosePickerProps): React.ReactElement {
  const {t} = useI18n()
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
        // studio 大纲面板的层级是 100,框体必须盖过它
        zIndex: 1000,
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
          {t('pg.pose.selectorTitle')}
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
      {/* 卡片列表:单列名称卡(姿势条目无缩略图字段) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {options.map((opt) => {
          const isCurrent = opt.key === current
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
                border: `1px solid ${
                  isCurrent
                    ? 'rgba(125, 193, 200, 0.45)'
                    : 'var(--theatre-panel-border, #1f1f1f)'
                }`,
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
