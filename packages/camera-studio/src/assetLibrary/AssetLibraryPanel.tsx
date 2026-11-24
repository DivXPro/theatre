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
import DetailPanelButton from '@dreamerbird/studio/uiComponents/DetailPanelButton'
import {useT} from '@dreamerbird/studio/i18n'
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
import {
  modelGroupOf,
  modelGroupOrder,
  modelPickerEntries,
} from './modelPickerEntries'
import {getUiConfig} from '../uiConfig'

export type AssetKind = 'model' | 'pose' | 'animation' | 'path'

/** 框体标题:一个组件四个实例,按类型各显各的(key 见 ./i18n) */
const KIND_TITLE_KEYS: Record<AssetKind, string> = {
  model: 'pg.lib.title.model',
  pose: 'pg.lib.title.pose',
  animation: 'pg.lib.title.animation',
  path: 'pg.lib.title.path',
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
/** 头部:照抄 studio 面板 TitleBar 的配色(#25272b + 黑色细分隔线) */
/** 头部小图标按钮:透明底,hover 用原生工具条按钮的 hover 色 */
/** filterRig 提示条:弱化处理,用文字弱化色 */
/** 姿势框体顶部工具行(抽帧存姿势) */
/** 姿势状态行(spec §6.2):来源 + 帧数居左,打帧/清除靠右 */
/** 卡片:面板色系,hover 用原生工具条按钮的 hover 色 */
/** 导入确认弹层:面板色系,盖在框体之上 */
/** 取消按钮:DetailPanelButton 的透明变体(teal 底让给主按钮) */
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
  activeModelId,
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
  activeModelId?: string
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
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [choices, setChoices] = useState<Array<'reuse' | 'keep'>>([])
  const [busy, setBusy] = useState(false)
  const [animationQuery, setAnimationQuery] = useState('')
  const [animationPack, setAnimationPack] = useState('')
  const [collapsedModelGroups, setCollapsedModelGroups] = useState<
    Partial<Record<(typeof modelGroupOrder)[number], boolean>>
  >({})
  const [collapsedPacks, setCollapsedPacks] = useState<Set<string>>(
    () => new Set(),
  )
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
      <div
        className="cs-asset-card"
        key={entry.id}
        data-placement-active={activeModelId === entry.id}
        data-disabled={disabled}
        onPointerDown={disabled ? undefined : modelGesture(entry)}
        onDragStart={(ev) => ev.preventDefault()}
        title={t('pg.lib.modelCardTitle')}
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
          <div className="cs-asset-thumb">📦</div>
        )}
        <div className="cs-asset-label" title={entry.name}>
          {entry.name}
        </div>
      </div>
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
    label = entry.name,
  ) => {
    const rigMismatch = filterRig ? entry.rig !== filterRig : false
    const cardDisabled = disabled || applyDisabled || !onApply || rigMismatch
    return (
      <div
        className="cs-asset-card"
        key={entry.id}
        data-disabled={cardDisabled}
        onClick={cardDisabled ? undefined : () => onApply!(entry)}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setMenu({x: ev.clientX, y: ev.clientY, id: entry.id})
        }}
      >
        <div className="cs-asset-thumb">{icon}</div>
        {/* 纯查看器模式隐藏改名入口(与导入/删除同套 canWrite 判别,
            终审 M-6):标签仍是纯展示,点击不再弹 prompt */}
        <div
          className="cs-asset-tag"
          style={getLibrary().canWrite ? {cursor: 'pointer'} : undefined}
          title={t('pg.lib.rigTitle', {rig: entry.rig})}
          onClick={getLibrary().canWrite ? renameRig(entry.rig) : undefined}
        >
          {rigLabel(entry.rig)}
          {rigMismatch && t('pg.lib.rigMismatch')}
        </div>
        <div className="cs-asset-label" title={entry.name}>
          {label}
        </div>
        {extra}
      </div>
    )
  }

  const renderAnimationCard = (entry: AnimationEntry) => {
    const pack = entry.packs?.[0]
    const prefix = `Mixamo ${pack} - `
    const label =
      pack && entry.name.startsWith(prefix)
        ? entry.name.slice(prefix.length)
        : entry.name
    return renderApplyCard(
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
      label,
    )
  }

  const renderPoseCard = (entry: PoseEntry) =>
    renderApplyCard(entry, '🧍', onApplyPose)

  // 预设卡片:内置不可删改,无右键菜单、无骨架标签;动画缩略图即运镜轨迹
  const renderPresetCard = (preset: PathPreset) => (
    <div
      className="cs-asset-card"
      key={preset.id}
      onPointerDown={presetGesture(preset)}
      onDragStart={(ev) => ev.preventDefault()}
      title={t('pg.lib.pathCardTitle')}
    >
      <div className="cs-asset-thumb" style={{fontSize: 0}}>
        <PathPresetThumb preset={preset} />
      </div>
      <div className="cs-asset-label">{t(`pg.pathPreset.${preset.id}`)}</div>
    </div>
  )

  const modelGroups = new Map<ReturnType<typeof modelGroupOf>, ModelEntry[]>()
  if (kind === 'model') {
    for (const entry of modelPickerEntries(models)) {
      const group = modelGroupOf(entry)
      const entries = modelGroups.get(group)
      if (entries) entries.push(entry)
      else modelGroups.set(group, [entry])
    }
  }
  const animationPacks =
    kind === 'animation'
      ? [...new Set(animations.flatMap((entry) => entry.packs ?? []))].sort(
          (left, right) => left.localeCompare(right),
        )
      : []
  const selectedPack = animationPacks.includes(animationPack)
    ? animationPack
    : ''
  const query = animationQuery.trim().toLowerCase()
  const animationGroups = new Map<string, AnimationEntry[]>()
  if (kind === 'animation') {
    for (const entry of sortBySelectedRig(animations)) {
      if (selectedPack && !entry.packs?.includes(selectedPack)) continue
      if (
        query &&
        ![
          entry.name,
          ...(entry.packs ?? []),
          ...(entry.aliases?.map((alias) => alias.name) ?? []),
        ].some((name) => name.toLowerCase().includes(query))
      ) {
        continue
      }
      const groupName = selectedPack || entry.packs?.[0] || ''
      const group = animationGroups.get(groupName)
      if (group) group.push(entry)
      else animationGroups.set(groupName, [entry])
    }
  }
  const visiblePoses = sortBySelectedRig(poses)

  return (
    <div
      className="cs-asset-panel"
      style={{left: KIND_OFFSET[kind], zIndex: getUiConfig().zIndexBase}}
    >
      {/* 头部:类型标题 + 导入(路径框体没有;纯查看器模式隐藏)+ 关闭 */}
      <div className="cs-asset-head">
        <span className="cs-asset-head-title">{t(KIND_TITLE_KEYS[kind])}</span>
        <div className="cs-asset-head-spacer" />
        {kind !== 'path' && getLibrary().canWrite && (
          <button
            className="cs-asset-head-button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title={t('pg.lib.import')}
          >
            <ImportIcon />
          </button>
        )}
        <button
          className="cs-asset-head-button"
          onClick={onClose}
          title={t('pg.lib.close')}
        >
          <CloseIcon />
        </button>
      </div>

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
        <div className="cs-asset-hint-bar">{t('pg.lib.filterHint')}</div>
      )}

      {kind === 'animation' && (
        <div className="cs-asset-animation-filters">
          <input
            type="search"
            aria-label={t('pg.lib.animationSearch')}
            placeholder={t('pg.lib.animationSearch')}
            value={animationQuery}
            onChange={(event) => setAnimationQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          {animationPacks.length > 0 && (
            <select
              aria-label={t('pg.lib.animationPack')}
              value={selectedPack}
              onChange={(event) => setAnimationPack(event.currentTarget.value)}
            >
              <option value="">{t('pg.lib.animationAllPacks')}</option>
              {animationPacks.map((pack) => (
                <option key={pack} value={pack}>
                  {pack}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 姿势框体顶部工具行:抽帧存姿势(纯查看器模式隐藏) */}
      {kind === 'pose' && getLibrary().canWrite && (
        <div className="cs-asset-tool-row">
          <DetailPanelButton
            disabled={!canSavePose}
            onClick={() => void onSavePose?.()}
            title={canSavePose ? undefined : t('pg.lib.savePoseDisabled')}
          >
            {t('pg.lib.savePose')}
          </DetailPanelButton>
        </div>
      )}

      {/* 姿势状态行(spec §6.2):来源 + 帧数 + 打帧/清除姿势 */}
      {kind === 'pose' && poseStatus !== undefined && (
        <div className="cs-asset-status-row">
          <span className="cs-asset-status-text">
            {poseStatus}
            {typeof poseKeyframeCount === 'number' &&
              ` · ${poseKeyframeCount} ${t('pg.pose.keyframesUnit')}`}
          </span>
          {onWritePoseKeyframe && (
            <DetailPanelButton
              className="cs-asset-overlay-action cs-asset-ghost-button"
              onClick={onWritePoseKeyframe}
            >
              {t('pg.pose.addKeyframe')}
            </DetailPanelButton>
          )}
          {onClearPose && (
            <DetailPanelButton
              className="cs-asset-overlay-action cs-asset-ghost-button"
              onClick={onClearPose}
            >
              {t('pg.pose.clear')}
            </DetailPanelButton>
          )}
        </div>
      )}

      {/* 卡片网格 */}
      <div className="cs-asset-grid">
        {kind === 'model'
          ? modelGroupOrder.map((group) => {
              const entries = modelGroups.get(group)
              if (!entries) return null
              const expanded = !collapsedModelGroups[group]
              return (
                <React.Fragment key={group}>
                  <h3 className="cs-asset-pack-heading">
                    <button
                      className="cs-asset-pack-toggle"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setCollapsedModelGroups((previous) => ({
                          ...previous,
                          [group]: !previous[group],
                        }))
                      }
                    >
                      {t(`pg.lib.modelGroup.${group}`)}
                    </button>
                  </h3>
                  {expanded && entries.map(renderModelCard)}
                </React.Fragment>
              )
            })
          : kind === 'pose'
            ? visiblePoses.map(renderPoseCard)
            : kind === 'path'
              ? PATH_PRESETS.map(renderPresetCard)
              : [...animationGroups].map(([pack, entries]) => {
                  const expanded = Boolean(
                    selectedPack || query || !collapsedPacks.has(pack),
                  )
                  const label = pack || t('pg.lib.animationUngrouped')
                  return (
                    <React.Fragment key={pack}>
                      {!selectedPack && (
                        <h3 className="cs-asset-pack-heading">
                          {query ? (
                            label
                          ) : (
                            <button
                              className="cs-asset-pack-toggle"
                              type="button"
                              aria-expanded={expanded}
                              onClick={() =>
                                setCollapsedPacks((previous) => {
                                  const next = new Set(previous)
                                  if (next.has(pack)) next.delete(pack)
                                  else next.add(pack)
                                  return next
                                })
                              }
                            >
                              {label}
                            </button>
                          )}
                        </h3>
                      )}
                      {expanded && entries.map(renderAnimationCard)}
                    </React.Fragment>
                  )
                })}
        {kind === 'animation' && query && animationGroups.size === 0 && (
          <p className="cs-asset-pack-heading" role="status">
            {t('pg.lib.animationNoResults')}
          </p>
        )}
      </div>

      {/* 确认清单弹层 */}
      {plan && (
        <div className="cs-asset-overlay">
          <div className="cs-asset-overlay-title">{plan.summary}</div>

          {plan.items.some((i) => i.type === 'skip') && (
            <div
              className="cs-asset-muted-text"
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
            </div>
          )}

          {plan.similar.length > 0 && (
            <div style={{marginBottom: 12}}>
              <div className="cs-asset-muted-text" style={{marginBottom: 6}}>
                {t('pg.lib.similar.title')}
              </div>
              {plan.similar.map((s, idx) => (
                <div
                  className="cs-asset-similar-card"
                  key={`${s.index}-${s.existingName}`}
                >
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
                </div>
              ))}
            </div>
          )}

          <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end'}}>
            <DetailPanelButton
              className="cs-asset-overlay-action cs-asset-ghost-button"
              disabled={busy}
              onClick={() => setPlan(null)}
            >
              {t('pg.lib.cancel')}
            </DetailPanelButton>
            <DetailPanelButton
              className="cs-asset-overlay-action cs-asset-confirm-button"
              disabled={busy}
              onClick={() => void confirmImport()}
            >
              {t('pg.lib.confirm')}
            </DetailPanelButton>
          </div>
        </div>
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
    </div>
  )
}
