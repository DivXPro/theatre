import {collectOutlineMenuItems} from './collectOutlineMenuItems'
import type {OutlineCollectionState} from '@dreamerbird/core/types/private/studio'
import type {OutlineMenuItem} from '@dreamerbird/core/types/public'
import type {SheetId, SheetInstanceId} from '@dreamerbird/core/types/public'

const sh1 = 'sh1' as SheetId
const si1 = 'si1' as SheetInstanceId

const collection = (
  id: string,
  name: string,
  members: string[],
): OutlineCollectionState => ({
  id,
  name,
  sheetId: sh1,
  sheetInstanceId: si1,
  members,
})

const t = (key: string, vars?: {[name: string]: string | number}) =>
  vars?.name !== undefined ? `${key}:{${vars.name}}` : key

const handlers = {
  onCopy: () => {},
  onPaste: () => {},
  onStartRename: () => {},
  onDelete: () => {},
  onMoveToCollection: (_id: string) => {},
  onRemoveFromCollection: () => {},
  onStartNewCollection: () => {},
}

const base = {
  t,
  clipboardSnapshot: undefined as undefined | {fingerprint: string; values: {}},
  targetFingerprint: 'fp',
  collections: [] as OutlineCollectionState[],
  currentCollectionId: undefined as string | undefined,
  extensionItems: [] as OutlineMenuItem[],
  handlers,
}

const labels = (items: ReturnType<typeof collectOutlineMenuItems>) =>
  items.map((i) => (i.type === 'separator' ? '—' : i.label))

describe('collectOutlineMenuItems', () => {
  it('无剪贴板时粘贴置灰,有匹配指纹的剪贴板时启用', () => {
    const disabled = collectOutlineMenuItems({...base})
    expect(disabled[1]).toMatchObject({
      label: 'outline.ctx.paste',
      enabled: false,
    })
    const enabled = collectOutlineMenuItems({
      ...base,
      clipboardSnapshot: {fingerprint: 'fp', values: {}},
    })
    expect(enabled[1]).toMatchObject({
      label: 'outline.ctx.paste',
      enabled: true,
    })
    const mismatch = collectOutlineMenuItems({
      ...base,
      clipboardSnapshot: {fingerprint: 'other', values: {}},
    })
    expect(mismatch[1]).toMatchObject({enabled: false})
  })

  it('内置顺序:复制/粘贴/重命名 → 集合项 → 分隔符 → 删除', () => {
    const items = collectOutlineMenuItems({...base})
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      '—',
      'outline.ctx.delete',
    ])
  })

  it('集合项:非当前集合出"移到集合",当前集合出"从集合移出"', () => {
    const collections: OutlineCollectionState[] = [
      collection('c1', 'A', ['Obj']),
      collection('c2', 'B', []),
    ]
    const items = collectOutlineMenuItems({
      ...base,
      collections,
      currentCollectionId: 'c1',
    })
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.moveToCollection:{B}',
      'outline.ctx.removeFromCollection',
      'outline.ctx.newCollection',
      '—',
      'outline.ctx.delete',
    ])
  })

  it('扩展项追加在内置项之后;role:delete 抑制内置删除与末尾分隔符', () => {
    const hostDelete: OutlineMenuItem = {
      type: 'normal',
      label: 'Host delete',
      onSelect: () => {},
      role: 'delete',
    }
    const items = collectOutlineMenuItems({
      ...base,
      extensionItems: [hostDelete],
    })
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      'Host delete',
    ])
  })

  it('无 delete-role 的扩展项出现时仍保留内置删除', () => {
    const extra: OutlineMenuItem = {
      type: 'normal',
      label: 'Host extra',
      onSelect: () => {},
    }
    const items = collectOutlineMenuItems({...base, extensionItems: [extra]})
    expect(labels(items)).toEqual([
      'outline.ctx.copy',
      'outline.ctx.paste',
      'outline.ctx.rename',
      'outline.ctx.newCollection',
      'Host extra',
      '—',
      'outline.ctx.delete',
    ])
  })
})
