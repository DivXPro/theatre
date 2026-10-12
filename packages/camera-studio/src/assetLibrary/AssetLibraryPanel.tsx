/**
 * 资产库框体:模型/路径/姿势/动作四种类型的选择面板,一个组件四个实例。
 *
 * 样式对齐 theatre 原生面板:骨架/标题栏配色取自 studio BasePanel
 * (panel-bg #282b2f、TitleBar #25272b),按钮复用 studio DetailPanelButton,
 * 卡片右键菜单复用 studio ContextMenu。--theatre-* 令牌定义在 studio 的
 * shadow DOM(:host),主文档不可见,一律带同值兜底——令牌将来全局化时
 * 自动接管(同 TopToolbar 的策略)。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react'
import styled from 'styled-components'
import DetailPanelButton from '@dreamerbird/studio/uiComponents/DetailPanelButton'
import {useI18n} from '@dreamerbird/studio/i18n'
import {CanvasContextMenu} from '../contextMenu'
import {countLibraryEntryUsage} from '../PlacementManager'
import {PATH_PRESETS} from '../pathPresets'
import type {PathPreset} from '../pathPresets'
import {PathPresetThumb} from '../PathPresetThumb'
import {getLibrary, useLibraryEntries, useRigAliases} from './library'
import {planImport, executeImport, realImportDeps} from './importPipeline'
import type {ImportPlan} from './importPipeline'
import {backfillModelThumbnails} from './thumbnail'
import {useModelThumbUrl} from './useModelThumbUrl'
import type {AnimationEntry, ModelEntry, PoseEntry} from './types'
import {getUiConfig} from '../uiConfig'

export type AssetKind = 'model' | 'pose' | 'animation' | 'path'

/** 框体标题:一个组件四个实例,按类型各显各的(key 见 ./i18n) */
const KIND_TITLE_KEYS: Record<AssetKind, string> = {
  model: 'pg.lib.title.model',
  pose: 'pg.lib.title.pose',
  animation: 'pg.lib.title.animation',
  path: 'pg.lib.title.path',
}

/** 预设卡片的显示名:内置预设自带中英双名,按界面语言取 */
function presetDisplayName(preset: PathPreset, language: string): string {
  return language.toLowerCase().startsWith('zh') ? preset.name : preset.en
}

/** 多框体同开时贴左边缘按类型错开,避免完全重叠 */
const KIND_OFFSET: Record<AssetKind, number> = {
  model: 0,
  path: 16,
  pose: 32,
  animation: 48,
}

/** 卡片手势阈值:按下后移动超过 4px 算拖拽(沿用场景点选的拖拽判定惯例) */
const DRAG_THRESHOLD_PX = 4

// ---------------------------------------------------------------------------
// 样式(theatre 原生色系,var() 全部带同值兜底)

/** 面板骨架:对齐 studio BasePanel 的底色/文字/字体 */
const Panel = styled.div`
  position: fixed;
  top: 0;
  bottom: 0;
  width: 260px;
  /* studio 大纲面板的层级是 100,面板必须盖过它;基准可配(ui.zIndexBase)。
     函数插值:渲染期现读,setUiConfig(boot 时)之后挂的首帧即生效 */
  z-index: ${() => getUiConfig().zIndexBase};
  display: flex;
  flex-direction: column;
  background: var(--theatre-panel-bg, #282b2f);
  border-right: 1px solid var(--theatre-panel-border, #1f1f1f);
  color: var(--theatre-text-primary, #ffffff);
  font-size: var(--theatre-font-size, 11px);
  font-family: var(
    --theatre-font-family,
    -apple-system,
    BlinkMacSystemFont,
    Segoe WPC,
    Segoe Editor,
    HelveticaNeue-Light,
    Ubuntu,
    Droid Sans,
    sans-serif
  );
`

/** 头部:照抄 studio 面板 TitleBar 的配色(#25272b + 黑色细分隔线) */
const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 12px;
  background-color: #25272b;
  border-bottom: 1px solid rgb(0 0 0 / 13%);
`

const HeadTitle = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--theatre-head-title, #bbbbbb);
`

const HeadSpacer = styled.div`
  flex: 1;
`

/** 头部小图标按钮:透明底,hover 用原生工具条按钮的 hover 色 */
const HeadButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--theatre-text-secondary, #cccccc);
  cursor: pointer;
  &:hover {
    background: rgba(59, 63, 69, 0.8);
    color: var(--theatre-text-primary, #ffffff);
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
    &:hover {
      background: transparent;
      color: var(--theatre-text-secondary, #cccccc);
    }
  }
`

/** filterRig 提示条:弱化处理,用文字弱化色 */
const HintBar = styled.div`
  padding: 8px 12px;
  font-size: 11px;
  color: var(--theatre-text-muted, #888888);
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid var(--theatre-panel-border, #1f1f1f);
`

/** 姿势框体顶部工具行(抽帧存姿势) */
const ToolRow = styled.div`
  display: flex;
  padding: 8px 12px;
  border-bottom: 1px solid var(--theatre-panel-border, #1f1f1f);
  /* DetailPanelButton 是 block + flex-grow,这里给它一行 */
  & > * {
    flex: 1;
  }
`

/** 姿势状态行(spec §6.2):来源 + 帧数居左,打帧/清除靠右 */
const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--theatre-panel-border, #1f1f1f);
  font-size: 11px;
  color: var(--theatre-text-secondary, #cccccc);
`

const StatusText = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Grid = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-content: start;
`

/** 卡片:面板色系,hover 用原生工具条按钮的 hover 色 */
const Card = styled.div`
  position: relative;
  height: 96px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--theatre-panel-border, #1f1f1f);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  &:hover {
    background: rgba(59, 63, 69, 0.8);
  }
  &[data-disabled='true'] {
    cursor: default;
    opacity: 0.5;
    &:hover {
      background: rgba(0, 0, 0, 0.18);
    }
  }
`

const Thumb = styled.div`
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  background: rgba(0, 0, 0, 0.25);
`

const Label = styled.div`
  position: absolute;
  bottom: 6px;
  left: 6px;
  right: 6px;
  font-size: 11px;
  color: var(--theatre-text-primary, #ffffff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Tag = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
  color: var(--theatre-text-secondary, #cccccc);
  background: rgba(0, 0, 0, 0.45);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

/** 导入确认弹层:面板色系,盖在框体之上 */
const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 16px;
  background: var(--theatre-panel-bg-99, rgba(40, 43, 47, 0.99));
`

const OverlayTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
`

const MutedText = styled.div`
  font-size: 11px;
  color: var(--theatre-text-muted, #888888);
`

const SimilarCard = styled.div`
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 3px;
  border: 1px solid var(--theatre-panel-border, #1f1f1f);
  background: rgba(0, 0, 0, 0.18);
  font-size: 11px;
`

/** 取消按钮:DetailPanelButton 的透明变体(teal 底让给主按钮) */
const GhostButton = styled(DetailPanelButton)`
  flex-grow: 0;
  background: transparent;
  border-color: var(--theatre-panel-border, #1f1f1f);
  &:hover {
    background: rgba(59, 63, 69, 0.8);
    border-color: var(--theatre-panel-border, #1f1f1f);
  }
`

const ConfirmButton = styled(DetailPanelButton)`
  flex-grow: 0;
`

/** 头部图标:导入(箭头出托盘向上)/ 关闭。16×16、currentColor */
const ImportIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 10.5V4M4.8 7.2L8 4l3.2 3.2"
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

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path
      d="M4.5 4.5l7 7M11.5 4.5l-7 7"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
)

// ---------------------------------------------------------------------------

/**
 * 卡片手势:按下后移动超阈值 = 拖拽(onDragStart 触发一次),否则松开 = 点击。
 * 监听挂 window:拖出卡片后移动/松手照样生效。右键不走这里(另有 onContextMenu)。
 */
function useCardGesture<T>(
  onClick: (item: T) => void,
  onDragStart?: (item: T) => void,
) {
  const gestureRef = useRef<{
    item: T
    x: number
    y: number
    dragging: boolean
  } | null>(null)
  const onClickRef = useRef(onClick)
  const onDragStartRef = useRef(onDragStart)
  onClickRef.current = onClick
  onDragStartRef.current = onDragStart

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current
      if (!g || g.dragging) return
      if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > DRAG_THRESHOLD_PX) {
        const start = onDragStartRef.current
        if (!start) return
        g.dragging = true
        start(g.item)
      }
    }
    const onUp = (ev: PointerEvent) => {
      // 按住左键时再松右键/中键也会触发 pointerup:只认左键松手,
      // 其他键的 up 不清手势也不结算,等左键自己的 up
      if (ev.button !== 0) return
      const g = gestureRef.current
      gestureRef.current = null
      if (g && !g.dragging) onClickRef.current(g.item)
    }
    // pointercancel/blur:手势被系统打断,清掉 gestureRef,否则陈旧手势
    // 会在下一次任意 pointerup 变成幻影放置
    const onCancel = () => {
      gestureRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
    }
  }, [])

  return useCallback(
    (item: T) => (ev: React.PointerEvent) => {
      if (ev.button !== 0) return
      gestureRef.current = {item, x: ev.clientX, y: ev.clientY, dragging: false}
    },
    [],
  )
}

export function AssetLibraryPanel({
  kind,
  onPlaceModel,
  onDragStartModel,
  onPlacePreset,
  onDragStartPreset,
  filterRig,
  onClose,
  onApplyAnimation,
  onApplyPose,
  onSavePose,
  canSavePose,
  applyDisabled,
  disabled,
  poseStatus,
  poseKeyframeCount,
  onWritePoseKeyframe,
  onClearPose,
}: {
  kind: AssetKind
  onPlaceModel?: (entry: ModelEntry) => void
  onDragStartModel?: (entry: ModelEntry) => void
  onPlacePreset?: (preset: PathPreset) => void
  onDragStartPreset?: (preset: PathPreset) => void
  filterRig?: string
  onClose: () => void
  onApplyAnimation?: (entry: AnimationEntry) => void
  onApplyPose?: (entry: PoseEntry) => void
  onSavePose?: () => void
  canSavePose?: boolean
  applyDisabled?: boolean
  disabled?: boolean
  /** 姿势状态行(spec §6.2):来源文案,由 App 用 poseStatusText 算好传入 */
  poseStatus?: string
  /** 姿势轨道关键帧数(命令式读取,随 App 重渲刷新) */
  poseKeyframeCount?: number
  onWritePoseKeyframe?: () => void
  onClearPose?: () => void
}) {
  const models = useLibraryEntries('model') as ModelEntry[]
  const poses = useLibraryEntries('pose') as PoseEntry[]
  const animations = useLibraryEntries('animation') as AnimationEntry[]
  const {t, language} = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [choices, setChoices] = useState<Array<'reuse' | 'keep'>>([])
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{x: number; y: number; id: string} | null>(
    null,
  )
  // 缩略图懒加载抽到 useModelThumbUrl(注册制改造:宿主模型框体也用它)
  const {getThumbUrl: thumbUrl, dropThumbUrl} = useModelThumbUrl()

  const modelGesture = useCardGesture<ModelEntry>(
    (entry) => onPlaceModel?.(entry),
    onDragStartModel,
  )
  const presetGesture = useCardGesture<PathPreset>(
    (preset) => onPlacePreset?.(preset),
    (preset) => onDragStartPreset?.(preset),
  )

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 内置模型不再随框体播种(2026-10-10 目录化):StaticCatalogSource
  // 以只读目录并入聚合库,条目随 listEntries 自然在列

  const rigAliases = useRigAliases()
  /** 骨架标签文案:有别名显示别名,否则短哈希 */
  const rigLabel = (rig: string) =>
    rigAliases[rig] ?? (rig.length > 12 ? rig.slice(0, 11) + '…' : rig)
  const renameRig = (rig: string) => (ev: React.MouseEvent) => {
    ev.stopPropagation() // 标签在卡片内,不能触发卡片的放置/套用
    const name = window
      .prompt(t('pg.lib.rigRenamePrompt'), rigAliases[rig] ?? '')
      ?.trim()
    if (name)
      void getLibrary()
        .setRigAlias(rig, name)
        .catch((err) => console.warn('[assetLibrary] 设置骨架别名失败', err))
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const p = await planImport([...files], getLibrary(), realImportDeps(), t)
      if (!mountedRef.current) return
      setChoices(p.similar.map(() => 'reuse'))
      setPlan(p)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const confirmImport = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await executeImport(plan, choices, getLibrary())
      // 补缩略图:导入成功的 model 项逐个渲染
      await backfillModelThumbnails(plan.items, getLibrary())
      if (!mountedRef.current) return
    } finally {
      if (mountedRef.current) {
        setBusy(false)
        setPlan(null)
      }
    }
  }

  const removeEntry = async (id: string) => {
    const entry = await getLibrary().getEntry(id)
    if (!entry) return
    const usage = countLibraryEntryUsage(id)
    const message =
      usage > 0
        ? t('pg.lib.delete.inUse', {name: entry.name, count: usage})
        : t('pg.lib.delete.unused', {name: entry.name})
    if (!window.confirm(message)) return
    await getLibrary().deleteEntryDeep(id)
    if (mountedRef.current) {
      dropThumbUrl(id)
    }
  }

  const renameEntry = async (id: string) => {
    const entry = await getLibrary().getEntry(id)
    if (!entry) return
    const name = window.prompt(t('pg.lib.renamePrompt'), entry.name)?.trim()
    if (name) await getLibrary().renameEntry(id, name)
  }

  const renderModelCard = (entry: ModelEntry) => {
    const url = thumbUrl(entry)
    return (
      <Card
        key={entry.id}
        onPointerDown={modelGesture(entry)}
        onDragStart={(ev) => ev.preventDefault()}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setMenu({x: ev.clientX, y: ev.clientY, id: entry.id})
        }}
      >
        {url ? (
          <img
            src={url}
            alt={entry.name}
            draggable={false}
            style={{width: '100%', height: 64, objectFit: 'cover'}}
          />
        ) : (
          <Thumb>📦</Thumb>
        )}
        <Label title={entry.name}>{entry.name}</Label>
      </Card>
    )
  }

  const sortBySelectedRig = <T extends {rig: string}>(list: T[]): T[] => {
    if (!filterRig) return list
    return [...list].sort((a, b) => {
      const aSame = a.rig === filterRig ? 1 : 0
      const bSame = b.rig === filterRig ? 1 : 0
      return bSame - aSame
    })
  }

  const renderApplyCard = <T extends AnimationEntry | PoseEntry>(
    entry: T,
    icon: string,
    onApply: ((entry: T) => void) | undefined,
    extra?: React.ReactNode,
  ) => {
    const rigMismatch = filterRig ? entry.rig !== filterRig : false
    const cardDisabled = disabled || applyDisabled || !onApply || rigMismatch
    return (
      <Card
        key={entry.id}
        data-disabled={cardDisabled}
        onClick={cardDisabled ? undefined : () => onApply!(entry)}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setMenu({x: ev.clientX, y: ev.clientY, id: entry.id})
        }}
      >
        <Thumb>{icon}</Thumb>
        {/* 纯查看器模式隐藏改名入口(与导入/删除同套 canWrite 判别,
            终审 M-6):标签仍是纯展示,点击不再弹 prompt */}
        <Tag
          style={getLibrary().canWrite ? {cursor: 'pointer'} : undefined}
          title={t('pg.lib.rigTitle', {rig: entry.rig})}
          onClick={getLibrary().canWrite ? renameRig(entry.rig) : undefined}
        >
          {rigLabel(entry.rig)}
          {rigMismatch && t('pg.lib.rigMismatch')}
        </Tag>
        <Label title={entry.name}>{entry.name}</Label>
        {extra}
      </Card>
    )
  }

  const renderAnimationCard = (entry: AnimationEntry) =>
    renderApplyCard(
      entry,
      '🎬',
      onApplyAnimation,
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 6,
          fontSize: 10,
          color: 'var(--theatre-text-muted, #888888)',
        }}
      >
        {entry.duration.toFixed(2)}s
      </div>,
    )

  const renderPoseCard = (entry: PoseEntry) =>
    renderApplyCard(entry, '🧍', onApplyPose)

  // 预设卡片:内置不可删改,无右键菜单、无骨架标签;动画缩略图即运镜轨迹
  const renderPresetCard = (preset: PathPreset) => (
    <Card
      key={preset.id}
      onPointerDown={presetGesture(preset)}
      onDragStart={(ev) => ev.preventDefault()}
      title={t('pg.lib.modelCardTitle')}
    >
      <Thumb style={{fontSize: 0}}>
        <PathPresetThumb preset={preset} />
      </Thumb>
      <Label>{presetDisplayName(preset, language)}</Label>
    </Card>
  )

  const visibleAnimations = sortBySelectedRig(animations)
  const visiblePoses = sortBySelectedRig(poses)

  return (
    <Panel style={{left: KIND_OFFSET[kind]}}>
      {/* 头部:类型标题 + 导入(路径框体没有;纯查看器模式隐藏)+ 关闭 */}
      <Head>
        <HeadTitle>{t(KIND_TITLE_KEYS[kind])}</HeadTitle>
        <HeadSpacer />
        {kind !== 'path' && getLibrary().canWrite && (
          <HeadButton
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title={t('pg.lib.import')}
          >
            <ImportIcon />
          </HeadButton>
        )}
        <HeadButton onClick={onClose} title={t('pg.lib.close')}>
          <CloseIcon />
        </HeadButton>
      </Head>

      <input
        ref={fileRef}
        type="file"
        multiple
        style={{display: 'none'}}
        onChange={(ev) => {
          void onPickFiles(ev.target.files)
          ev.target.value = ''
        }}
      />

      {/* filterRig 提示条:姿势/动作共用 */}
      {(kind === 'animation' || kind === 'pose') && filterRig && (
        <HintBar>{t('pg.lib.filterHint')}</HintBar>
      )}

      {/* 姿势框体顶部工具行:抽帧存姿势(纯查看器模式隐藏) */}
      {kind === 'pose' && getLibrary().canWrite && (
        <ToolRow>
          <DetailPanelButton
            disabled={!canSavePose}
            onClick={() => void onSavePose?.()}
            title={canSavePose ? undefined : t('pg.lib.savePoseDisabled')}
          >
            {t('pg.lib.savePose')}
          </DetailPanelButton>
        </ToolRow>
      )}

      {/* 姿势状态行(spec §6.2):来源 + 帧数 + 打帧/清除姿势 */}
      {kind === 'pose' && poseStatus !== undefined && (
        <StatusRow>
          <StatusText>
            {poseStatus}
            {typeof poseKeyframeCount === 'number' &&
              ` · ${poseKeyframeCount} ${t('pg.pose.keyframesUnit')}`}
          </StatusText>
          {onWritePoseKeyframe && (
            <GhostButton onClick={onWritePoseKeyframe}>
              {t('pg.pose.addKeyframe')}
            </GhostButton>
          )}
          {onClearPose && (
            <GhostButton onClick={onClearPose}>
              {t('pg.pose.clear')}
            </GhostButton>
          )}
        </StatusRow>
      )}

      {/* 卡片网格 */}
      <Grid>
        {kind === 'model'
          ? models.map(renderModelCard)
          : kind === 'pose'
            ? visiblePoses.map(renderPoseCard)
            : kind === 'path'
              ? PATH_PRESETS.map(renderPresetCard)
              : visibleAnimations.map(renderAnimationCard)}
      </Grid>

      {/* 确认清单弹层 */}
      {plan && (
        <Overlay>
          <OverlayTitle>{plan.summary}</OverlayTitle>

          {plan.items.some((i) => i.type === 'skip') && (
            <MutedText
              style={{
                maxHeight: 120,
                overflowY: 'auto',
                marginBottom: 12,
              }}
            >
              {plan.items
                .filter(
                  (i): i is {type: 'skip'; name: string; reason: string} =>
                    i.type === 'skip',
                )
                .map((i, idx) => (
                  <div key={idx} style={{marginBottom: 4}}>
                    {i.name}: {i.reason}
                  </div>
                ))}
            </MutedText>
          )}

          {plan.similar.length > 0 && (
            <div style={{marginBottom: 12}}>
              <MutedText style={{marginBottom: 6}}>
                {t('pg.lib.similar.title')}
              </MutedText>
              {plan.similar.map((s, idx) => (
                <SimilarCard key={`${s.index}-${s.existingName}`}>
                  <div
                    style={{
                      marginBottom: 4,
                      color: 'var(--theatre-text-primary, #ffffff)',
                    }}
                  >
                    {t('pg.lib.similar.desc', {
                      newName: s.newName,
                      existingName: s.existingName,
                    })}
                  </div>
                  <label style={{marginRight: 16, cursor: 'pointer'}}>
                    <input
                      type="radio"
                      name={`similar-${idx}`}
                      checked={choices[idx] === 'reuse'}
                      onChange={() =>
                        setChoices((prev) => {
                          const next = [...prev]
                          next[idx] = 'reuse'
                          return next
                        })
                      }
                      style={{marginRight: 4}}
                    />
                    {t('pg.lib.similar.reuse')}
                  </label>
                  <label style={{cursor: 'pointer'}}>
                    <input
                      type="radio"
                      name={`similar-${idx}`}
                      checked={choices[idx] === 'keep'}
                      onChange={() =>
                        setChoices((prev) => {
                          const next = [...prev]
                          next[idx] = 'keep'
                          return next
                        })
                      }
                      style={{marginRight: 4}}
                    />
                    {t('pg.lib.similar.keep')}
                  </label>
                </SimilarCard>
              ))}
            </div>
          )}

          <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end'}}>
            <GhostButton disabled={busy} onClick={() => setPlan(null)}>
              {t('pg.lib.cancel')}
            </GhostButton>
            <ConfirmButton disabled={busy} onClick={() => void confirmImport()}>
              {t('pg.lib.confirm')}
            </ConfirmButton>
          </div>
        </Overlay>
      )}

      {/* 卡片右键菜单:studio 原生 ContextMenu(点外/Esc 关闭由它处理)。
          纯查看器模式整体隐藏:菜单项全是写操作(重命名/删除) */}
      {menu && getLibrary().canWrite && (
        <CanvasContextMenu
          position={{x: menu.x, y: menu.y}}
          onClose={() => setMenu(null)}
          items={[
            {
              type: 'normal',
              label: t('pg.lib.ctx.rename'),
              callback: () => {
                void renameEntry(menu.id)
                setMenu(null)
              },
            },
            {
              type: 'normal',
              label: t('pg.lib.ctx.delete'),
              callback: () => {
                void removeEntry(menu.id)
                setMenu(null)
              },
            },
          ]}
        />
      )}
    </Panel>
  )
}
