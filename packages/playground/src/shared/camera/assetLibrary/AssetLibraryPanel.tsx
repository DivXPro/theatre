import React, {useEffect, useRef, useState} from 'react'
import {countLibraryEntryUsage} from '../PlacementManager'
import {getLibrary, useLibraryEntries} from './library'
import {planImport, executeImport, realImportDeps} from './importPipeline'
import type {ImportPlan} from './importPipeline'
import {renderThumbnail} from './thumbnail'
import type {AnimationEntry, ModelEntry, PoseEntry} from './types'

type Tab = 'model' | 'pose' | 'animation'

export function AssetLibraryPanel({
  onPlaceModel,
  filterRig,
  onClose,
  onApplyAnimation,
  onApplyPose,
  onSavePose,
  canSavePose,
  applyDisabled,
  disabled,
}: {
  onPlaceModel: (entry: ModelEntry) => void
  filterRig?: string
  onClose: () => void
  onApplyAnimation?: (entry: AnimationEntry) => void
  onApplyPose?: (entry: PoseEntry) => void
  onSavePose?: () => void
  canSavePose?: boolean
  applyDisabled?: boolean
  disabled?: boolean
}) {
  const [tab, setTab] = useState<Tab>('model')
  const models = useLibraryEntries('model') as ModelEntry[]
  const poses = useLibraryEntries('pose') as PoseEntry[]
  const animations = useLibraryEntries('animation') as AnimationEntry[]
  const fileRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [choices, setChoices] = useState<Array<'reuse' | 'keep'>>([])
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{x: number; y: number; id: string} | null>(
    null,
  )
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 防止同一缩略图并发多次 getBlobUrl
  const loadingThumbsRef = useRef<Set<string>>(new Set())

  // 缩略图 URL 懒加载:卡片出现时取 blob URL 并缓存。
  // URL 生命周期由后端的 session 级缓存管理,组件侧只维护 id->url 映射,
  // 不在卸载或删除时 revoke,避免其他消费者拿到失效地址。
  const thumbUrl = (entry: ModelEntry): string | undefined => {
    if (!entry.thumbnailId) return undefined
    const cached = thumbUrls[entry.id]
    if (cached) return cached
    if (loadingThumbsRef.current.has(entry.id)) return undefined
    loadingThumbsRef.current.add(entry.id)
    void getLibrary()
      .backend.getBlobUrl(entry.thumbnailId)
      .then((url) => {
        loadingThumbsRef.current.delete(entry.id)
        if (!mountedRef.current) return
        setThumbUrls((m) => ({...m, [entry.id]: url}))
      })
      .catch(() => {
        loadingThumbsRef.current.delete(entry.id)
      })
    return undefined
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const p = await planImport(
        [...files],
        getLibrary().backend,
        realImportDeps(),
      )
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
      for (const item of plan.items) {
        if (item.type !== 'model') continue
        const blob = await renderThumbnail(item.glb)
        if (!blob) continue
        const list = (await getLibrary().backend.listEntries(
          'model',
        )) as ModelEntry[]
        const entry = list.find(
          (e) => e.contentHash === item.contentHash && !e.thumbnailId,
        )
        if (entry) {
          await getLibrary().putBlobWithEntry(blob, (thumbnailId) => ({
            ...entry,
            thumbnailId,
          }))
          if (!mountedRef.current) return
        }
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false)
        setPlan(null)
      }
    }
  }

  const removeEntry = async (id: string) => {
    const entry = await getLibrary().backend.getEntry(id)
    if (!entry) return
    const usage = countLibraryEntryUsage(id)
    const message =
      usage > 0
        ? `删除「${entry.name}」?场景中有 ${usage} 个实例正在使用它,删除后这些实例将回退为绑定姿势/无动作或无法加载。`
        : `删除「${entry.name}」?场景里已放置的实例不受影响。`
    if (!window.confirm(message)) return
    await getLibrary().deleteEntryDeep(id)
    if (mountedRef.current) {
      setThumbUrls((m) => {
        const {[id]: _, ...rest} = m
        return rest
      })
    }
  }

  const renameEntry = async (id: string) => {
    const entry = await getLibrary().backend.getEntry(id)
    if (!entry) return
    const name = window.prompt('重命名', entry.name)?.trim()
    if (name) await getLibrary().renameEntry(id, name)
  }

  // 卡片右键菜单:点菜单外或按 Esc 关闭
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement | null)?.closest('[data-card-menu]')) {
        setMenu(null)
      }
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const cardBaseStyle: React.CSSProperties = {
    position: 'relative',
    height: 96,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
    cursor: 'pointer',
    userSelect: 'none',
  }

  const placeholderStyle: React.CSSProperties = {
    width: '100%',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    background: 'rgba(255,255,255,0.04)',
  }

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  const tagStyle: React.CSSProperties = {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    background: 'rgba(0,0,0,0.35)',
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const renderModelCard = (entry: ModelEntry) => {
    const url = thumbUrl(entry)
    return (
      <div
        key={entry.id}
        style={cardBaseStyle}
        onClick={() => onPlaceModel(entry)}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setMenu({x: ev.clientX, y: ev.clientY, id: entry.id})
        }}
      >
        {url ? (
          <img
            src={url}
            alt={entry.name}
            style={{width: '100%', height: 64, objectFit: 'cover'}}
          />
        ) : (
          <div style={placeholderStyle}>📦</div>
        )}
        <div style={tagStyle} title={entry.rig}>
          {entry.rig}
        </div>
        <div style={labelStyle} title={entry.name}>
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
  ) => {
    const rigMismatch = filterRig ? entry.rig !== filterRig : false
    const cardDisabled = disabled || applyDisabled || !onApply || rigMismatch
    return (
      <div
        key={entry.id}
        style={{
          ...cardBaseStyle,
          cursor: cardDisabled ? 'default' : 'pointer',
          opacity: cardDisabled ? 0.5 : 1,
        }}
        onClick={cardDisabled ? undefined : () => onApply!(entry)}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setMenu({x: ev.clientX, y: ev.clientY, id: entry.id})
        }}
      >
        <div style={placeholderStyle}>{icon}</div>
        <div style={tagStyle} title={entry.rig}>
          {entry.rig}
          {rigMismatch && ' · 骨架不匹配'}
        </div>
        <div style={labelStyle} title={entry.name}>
          {entry.name}
        </div>
        {extra}
      </div>
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
          color: 'rgba(255,255,255,0.55)',
        }}
      >
        {entry.duration.toFixed(2)}s
      </div>,
    )

  const renderPoseCard = (entry: PoseEntry) =>
    renderApplyCard(entry, '🧍', onApplyPose)

  const visibleAnimations = sortBySelectedRig(animations)
  const visiblePoses = sortBySelectedRig(poses)

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 260,
        // studio 大纲面板的层级是 100,面板必须盖过它
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(24,24,28,0.96)',
        borderRight: '1px solid rgba(255,255,255,0.12)',
        color: 'rgba(255,255,255,0.9)',
        fontSize: 13,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 头部:tab 切换 + 导入 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <button
          onClick={() => setTab('model')}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background:
              tab === 'model' ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: 'rgba(255,255,255,0.9)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          模型
        </button>
        <button
          onClick={() => setTab('pose')}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background:
              tab === 'pose' ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: 'rgba(255,255,255,0.9)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          姿势
        </button>
        <button
          onClick={() => setTab('animation')}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background:
              tab === 'animation' ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: 'rgba(255,255,255,0.9)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          动作
        </button>
        <div style={{flex: 1}} />
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.9)',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 13,
          }}
        >
          导入
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            fontSize: 15,
          }}
          aria-label="关闭"
        >
          ×
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
      {(tab === 'animation' || tab === 'pose') && filterRig && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 12,
            color: 'rgba(255,255,255,0.7)',
            background: 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          只列出同骨架族的条目可套用,不同族的已置灰
        </div>
      )}

      {/* 姿势 tab 顶部工具行:抽帧存姿势 */}
      {tab === 'pose' && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <button
            disabled={!canSavePose}
            onClick={() => void onSavePose?.()}
            title={canSavePose ? undefined : '先选中一个带骨架的已放置模型'}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: canSavePose
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(255,255,255,0.04)',
              color: canSavePose
                ? 'rgba(255,255,255,0.9)'
                : 'rgba(255,255,255,0.4)',
              cursor: canSavePose ? 'pointer' : 'default',
              fontSize: 13,
            }}
          >
            存当前姿势
          </button>
        </div>
      )}

      {/* 卡片网格 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {tab === 'model'
          ? models.map(renderModelCard)
          : tab === 'pose'
            ? visiblePoses.map(renderPoseCard)
            : visibleAnimations.map(renderAnimationCard)}
      </div>

      {/* 确认清单弹层 */}
      {plan && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(18,18,22,0.98)',
          }}
        >
          <div style={{fontSize: 14, fontWeight: 600, marginBottom: 10}}>
            {plan.summary}
          </div>

          {plan.items.some((i) => i.type === 'skip') && (
            <div
              style={{
                maxHeight: 120,
                overflowY: 'auto',
                marginBottom: 12,
                fontSize: 12,
                color: 'rgba(255,255,255,0.7)',
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
              <div
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: 6,
                }}
              >
                检测到相似模型,请选择处理方式:
              </div>
              {plan.similar.map((s, idx) => (
                <div
                  key={`${s.index}-${s.existingName}`}
                  style={{
                    padding: '8px 10px',
                    marginBottom: 6,
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.05)',
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{marginBottom: 4, color: 'rgba(255,255,255,0.85)'}}
                  >
                    新文件「{s.newName}」与库中「{s.existingName}」相似
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
                    复用库中(丢弃新文件)
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
                    保留为新条目
                  </label>
                </div>
              ))}
            </div>
          )}

          <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end'}}>
            <button
              disabled={busy}
              onClick={() => setPlan(null)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.9)',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 13,
              }}
            >
              取消
            </button>
            <button
              disabled={busy}
              onClick={() => void confirmImport()}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(255,255,255,0.18)',
                color: '#fff',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 13,
              }}
            >
              确认
            </button>
          </div>
        </div>
      )}

      {/* 卡片右键菜单 */}
      {menu && (
        <div
          data-card-menu
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 30,
            minWidth: 120,
            padding: '4px 0',
            borderRadius: 8,
            background: 'rgba(24,24,28,0.96)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              padding: '6px 14px',
              fontSize: 13,
              color: 'rgba(255,255,255,0.9)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            onClick={() => {
              void renameEntry(menu.id)
              setMenu(null)
            }}
          >
            重命名
          </div>
          <div
            style={{
              padding: '6px 14px',
              fontSize: 13,
              color: '#ff6b6b',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,107,107,0.12)')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            onClick={() => {
              void removeEntry(menu.id)
              setMenu(null)
            }}
          >
            删除
          </div>
        </div>
      )}
    </div>
  )
}
