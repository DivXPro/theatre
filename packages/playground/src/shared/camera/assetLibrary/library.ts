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
}

let singleton: Library | undefined

/** 库单例:playground 固定用 IndexedDB 实现 */
export function getLibrary(): Library {
  return (singleton ??= new Library(new IndexedDBBackend()))
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
