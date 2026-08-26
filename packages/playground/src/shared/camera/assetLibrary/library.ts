import {useEffect, useState} from 'react'
import {IndexedDBBackend} from './indexedDBBackend'
import type {EntryKind, LibraryBackend, LibraryEntry} from './types'

/**
 * 库的对外门面:backend 直读,写操作在 backend 之上加变更事件,
 * React 侧用 useLibraryEntries 订阅刷新。换远程后端时只需在
 * getLibrary 里注入不同 LibraryBackend 实现。
 */
export class Library {
  private listeners = new Set<() => void>()

  constructor(readonly backend: LibraryBackend) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    await this.backend.putEntry(entry)
    this.emit()
  }

  async deleteEntry(id: string): Promise<void> {
    await this.backend.deleteEntry(id)
    this.emit()
  }

  async renameEntry(id: string, name: string): Promise<void> {
    const entry = await this.backend.getEntry(id)
    if (!entry) return
    await this.backend.putEntry({...entry, name})
    this.emit()
  }

  /** 所有条目引用的 blob id 集合(模型 blobId + thumbnailId) */
  private async referencedBlobIds(): Promise<Set<string>> {
    const entries = await this.backend.listEntries()
    const ids = new Set<string>()
    for (const e of entries) {
      if ('blobId' in e) ids.add(e.blobId)
      if (e.kind === 'model' && e.thumbnailId) ids.add(e.thumbnailId)
    }
    return ids
  }

  /** 删条目并清理它的 blob;blob 被其他条目共享时保留 */
  async deleteEntryDeep(id: string): Promise<void> {
    const entry = await this.backend.getEntry(id)
    if (!entry) return
    const own: string[] = []
    if ('blobId' in entry) own.push(entry.blobId)
    if (entry.kind === 'model' && entry.thumbnailId) own.push(entry.thumbnailId)
    await this.backend.deleteEntry(id)
    const referenced = await this.referencedBlobIds()
    for (const blobId of own) {
      if (!referenced.has(blobId)) await this.backend.deleteBlob(blobId)
    }
    this.emit()
  }

  /** 清理无条目引用的孤儿 blob,返回删除数量 */
  async sweepOrphanBlobs(): Promise<number> {
    const referenced = await this.referencedBlobIds()
    const all = await this.backend.listBlobIds()
    let n = 0
    for (const id of all) {
      if (!referenced.has(id)) {
        await this.backend.deleteBlob(id)
        n++
      }
    }
    return n
  }
}

let singleton: Library | undefined

/** 库单例:playground 固定用 IndexedDB 实现 */
export function getLibrary(): Library {
  if (!singleton) {
    singleton = new Library(new IndexedDBBackend())
    // 启动时清理孤儿 blob(上次导入中断等留下的),失败不阻塞
    void singleton.sweepOrphanBlobs().catch((err) => {
      console.warn('[assetLibrary] 孤儿 blob 清理失败', err)
    })
  }
  return singleton
}

/** 订阅式读库条目:导入/删除/重命名后自动刷新 */
export function useLibraryEntries(kind?: EntryKind): LibraryEntry[] {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  useEffect(() => {
    let alive = true
    const reload = () => {
      void getLibrary()
        .backend.listEntries(kind)
        .then((list) => {
          if (alive) setEntries(list)
        })
    }
    reload()
    const unsub = getLibrary().subscribe(reload)
    return () => {
      alive = false
      unsub()
    }
  }, [kind])
  return entries
}
