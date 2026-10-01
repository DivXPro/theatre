/**
 * 属性面板姿势区(2026-10-01):选中带骨骼的已放置模型时,作为「姿势」
 * 分区渲染在详情面板(DetailPanel-Object)内部末尾——姿势来源选择器
 * (绑定/自定义/库预设) + 状态行(来源 · 帧数) + 打帧/清除/摆姿势。
 *
 * 实现:详情面板在 studio shadow DOM 内,playground 改不了它的 React
 * 树,改为往面板容器末尾 appendChild 一个 slot div 再 createPortal
 * 渲染——React 的 reconciliation 只管理自己创建的子节点,末尾的外部
 * 节点不受影响;面板整树重建(选中切换)时由轮询检测并重注入。slot
 * 在面板文档流内,随面板显隐/挪动,且同在 shadow root,--theatre-*
 * 令牌直接可用。
 *
 * 样式全部 inline:styled-components 的样式表插在主文档 head,对
 * shadow DOM 内的 portal 内容不生效(studio 自己的组件走的是
 * withStyledShadow 注入 shadow root 的另一份样式表,我们不共用)。
 * 按钮外观照抄 studio DetailPanelButton 的配色,保持面板原生观感。
 */
import React, {useEffect, useState} from 'react'
import {useI18n} from '@dreamerbird/studio/i18n'
import type {PoseOption, PoseOptionKey} from './poseOptions'

/**
 * 详情面板容器末尾的姿势区挂点。面板(选中 SheetObject 才渲染)不存在
 * 或整树被 React 重建时返回 null,由调用方停渲染;300ms 轮询兜底重注入。
 */
export function useDetailPanelSlot(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled) {
      setSlot(null)
      return
    }
    const ensure = () => {
      const host = document.getElementById('theatrejs-studio-root')
      // 视觉回归模式 withStyledShadow 退化为普通 div,无 shadowRoot
      const root =
        host?.shadowRoot ??
        document.getElementById('theatrejs-faux-shadow-root')
      const panel =
        root?.querySelector('[data-testid="DetailPanel-Object"]') ?? null
      if (!panel) {
        setSlot((s) => (s && s.isConnected ? s : null))
        return
      }
      const existing = panel.querySelector(
        ':scope > [data-pose-prop-slot]',
      ) as HTMLElement | null
      if (existing) {
        setSlot(existing)
        return
      }
      const div = document.createElement('div')
      div.setAttribute('data-pose-prop-slot', '')
      panel.appendChild(div)
      setSlot(div)
    }
    ensure()
    const timer = window.setInterval(ensure, 300)
    return () => window.clearInterval(timer)
  }, [enabled])
  return enabled ? slot : null
}

/** 面板原生按钮(照抄 studio DetailPanelButton 配色,inline 样式) */
const PanelButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}> = ({onClick, disabled, title, children}) => {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        textAlign: 'center',
        padding: 8,
        borderRadius: 2,
        border: `1px solid ${hover && !disabled ? '#9ebcbf' : '#627b7b87'}`,
        backgroundColor: hover && !disabled ? '#7dc1c878' : '#4b787d3d',
        color: '#eaeaea',
        fontWeight: 400,
        fontSize: 11,
        appearance: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  )
}

export type PosePropSectionProps = {
  options: PoseOption[]
  current: PoseOptionKey
  onSelect: (key: PoseOptionKey) => void
  status: string
  keyframeCount: number
  onAddKeyframe: () => void
  onClear: () => void
  /** 骨架映射不出人形关键骨时为 undefined → 摆姿势按钮置灰 */
  onEnterPoseMode?: () => void
  poseModeHint?: string
}

const PosePropSection: React.FC<PosePropSectionProps> = ({
  options,
  current,
  onSelect,
  status,
  keyframeCount,
  onAddKeyframe,
  onClear,
  onEnterPoseMode,
  poseModeHint,
}) => {
  const {t} = useI18n()
  return (
    <div
      data-testid="PosePropSection"
      style={{
        borderTop: '1px solid var(--theatre-panel-border, #1f1f1f)',
        marginTop: 2,
        padding: '6px 8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 11,
        color: 'var(--theatre-text-secondary, #cccccc)',
        userSelect: 'none',
      }}
    >
      <div style={{color: '#919191', fontWeight: 500, fontSize: 10}}>
        {t('pg.props.pose')} · {t('pg.pose.selectorTitle')}
      </div>
      <select
        value={current}
        onChange={(e) => onSelect(e.target.value as PoseOptionKey)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '3px 4px',
          borderRadius: 2,
          border: '1px solid var(--theatre-panel-border, #1f1f1f)',
          background: 'rgba(0, 0, 0, 0.25)',
          color: 'var(--theatre-text-primary, #ffffff)',
          fontSize: 11,
          outline: 'none',
        }}
      >
        {options.map((opt) => (
          <option
            key={opt.key}
            value={opt.key}
            disabled={opt.disabled === true}
          >
            {opt.label}
            {opt.hint ?? ''}
          </option>
        ))}
      </select>
      <div
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {status}
        {` · ${keyframeCount} ${t('pg.pose.keyframesUnit')}`}
      </div>
      <div style={{display: 'flex', gap: 6}}>
        <PanelButton onClick={onAddKeyframe}>
          {t('pg.pose.addKeyframe')}
        </PanelButton>
        <PanelButton onClick={onClear}>{t('pg.pose.clear')}</PanelButton>
        <PanelButton
          disabled={!onEnterPoseMode}
          title={onEnterPoseMode ? undefined : poseModeHint}
          onClick={() => onEnterPoseMode?.()}
        >
          {t('pg.menu.poseMode')}
        </PanelButton>
      </div>
    </div>
  )
}

export default PosePropSection
