import type {ContextMenuItem} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {OutlineMenuItem} from '@dreamerbird/core/types/public'
import type {ObjectSnapshot} from './clipboard'

export type OutlineT = (
  key: string,
  vars?: {[name: string]: string | number},
) => string

export type OutlineMenuHandlers = {
  onCopy(): void
  onPaste(): void
  onStartRename(): void
  onDelete(): void
  onMoveToCollection(collectionId: string): void
  onRemoveFromCollection(): void
  onStartNewCollection(): void
}

/**
 * 对象行右键菜单装配(spec §2 + §4 顺序):
 * 复制/粘贴/重命名 → [移到集合:{name}…/从集合移出/新建集合…] →
 * 扩展项(注册顺序) → [分隔符 + 删除]。
 * 任一扩展项带 role:'delete' 时,内置删除与末尾分隔符整组省略(spec §1)。
 */
export function collectOutlineMenuItems(p: {
  t: OutlineT
  clipboardSnapshot: ObjectSnapshot | undefined
  targetFingerprint: string
  collections: OutlineCollectionState[]
  currentCollectionId: string | undefined
  extensionItems: OutlineMenuItem[]
  handlers: OutlineMenuHandlers
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      type: 'normal',
      label: p.t('outline.ctx.copy'),
      callback: p.handlers.onCopy,
    },
    {
      type: 'normal',
      label: p.t('outline.ctx.paste'),
      callback: p.handlers.onPaste,
      enabled:
        !!p.clipboardSnapshot &&
        p.clipboardSnapshot.fingerprint === p.targetFingerprint,
    },
    {
      type: 'normal',
      label: p.t('outline.ctx.rename'),
      callback: p.handlers.onStartRename,
    },
  ]

  for (const collection of p.collections) {
    if (collection.id === p.currentCollectionId) continue
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.moveToCollection', {name: collection.name}),
      callback: () => p.handlers.onMoveToCollection(collection.id),
    })
  }
  if (p.currentCollectionId) {
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.removeFromCollection'),
      callback: p.handlers.onRemoveFromCollection,
    })
  }
  items.push({
    type: 'normal',
    label: p.t('outline.ctx.newCollection'),
    callback: p.handlers.onStartNewCollection,
  })

  for (const extItem of p.extensionItems) {
    items.push({
      type: 'normal',
      label: extItem.label,
      enabled: extItem.enabled,
      callback: extItem.onSelect,
    })
  }

  const hasHostDelete = p.extensionItems.some((i) => i.role === 'delete')
  if (!hasHostDelete) {
    items.push({type: 'separator'})
    items.push({
      type: 'normal',
      label: p.t('outline.ctx.delete'),
      callback: p.handlers.onDelete,
    })
  }
  return items
}

/** 空白处"新建集合"的默认名:集合 N(N 从现有数量+1 起,冲突顺延) */
export function nextDefaultCollectionName(
  collections: OutlineCollectionState[],
  t: OutlineT,
): string {
  const taken = new Set(collections.map((c) => c.name))
  for (let n = collections.length + 1; n < collections.length + 1000; n++) {
    const name = t('outline.ctx.defaultCollectionName', {n})
    if (!taken.has(name)) return name
  }
  return t('outline.ctx.defaultCollectionName', {n: Date.now()})
}
