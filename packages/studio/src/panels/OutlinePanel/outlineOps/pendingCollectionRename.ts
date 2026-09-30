import {Atom} from '@dreamerbird/dataverse'

/**
 * 新建集合后的"待改名"登记(单发信箱):创建动作把新集合 id 放进来,
 * 集合行挂载时发现是自己就进入改名输入态并清掉。瞬态 UI 意图,
 * 不进状态树,刷新即弃。
 */
const pendingCollectionRenameId = new Atom<string | null>(null)

export function setPendingCollectionRename(id: string): void {
  pendingCollectionRenameId.set(id)
}

/** 集合行认领待改名登记:是自己的 id 就清掉并返回 true,只生效一次 */
export function takePendingCollectionRename(id: string): boolean {
  if (pendingCollectionRenameId.get() !== id) return false
  pendingCollectionRenameId.set(null)
  return true
}
