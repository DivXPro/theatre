import {useEffect, useState} from 'react'
import {IndexedDBBackend} from './indexedDBBackend'
import {isWritableSource, LibraryError} from './source'
import type {LibrarySource, WritableLibrarySource} from './source'
import type {EntryKind, LibraryEntry, RigAlias} from './types'

export type LibraryOpts = {
  sources: LibrarySource[]
  writable?: WritableLibrarySource
  onError?: (err: LibraryError) => void
}

/** 内置目录条目的保留 id 前缀:出现在可写源即剔除并告警(内置数据只读) */
const BUILTIN_ID_PREFIXES = ['seed-pose-', 'seed-model-']

/**
 * 库的对外门面:多数据源聚合器(2026-10-10 spec §5 统一数据源)。
 * 读——listEntries 合并各源(同 id 先注册者胜),getBlobUrl 按 blobId
 * 前缀路由;写——一律路由到可写源(缺省 = sources 里第一个
 * isWritableSource),纯查看器模式(无可写源)写操作抛
 * LibraryError('auth')。写操作在可写源之上加变更事件,React 侧用
 * useLibraryEntries 订阅刷新。
 */
export class Library {
  readonly sources: LibrarySource[]
  readonly writable?: WritableLibrarySource
  private onError?: (err: LibraryError) => void
  private listeners = new Set<() => void>()
  private queue: Promise<void> = Promise.resolve()
  private entriesSnapshot: readonly LibraryEntry[] = []
  /** id → 所属数据源映射:条目每次重载(listEntries/快照刷新)时重建 */
  private entrySourceMap = new Map<string, LibrarySource>()

  constructor(opts: LibraryOpts) {
    this.sources = opts.sources
    this.writable = opts.writable ?? opts.sources.find(isWritableSource)
    this.onError = opts.onError
    this.refreshSnapshot()
  }

  /** 纯查看器模式(无可写源)为 false:宿主应隐藏导入/删除/保存姿势入口 */
  get canWrite(): boolean {
    return this.writable !== undefined
  }

  /**
   * 同步读条目快照:给 stringLiteral 动态选项这类无法 await 的场景用。
   * 快照在构造时与每次写操作后刷新,读取可能比最新状态差一拍——
   * 选项是渲染时现取的,下一次渲染即为最新。
   */
  getEntriesSnapshot(): readonly LibraryEntry[] {
    return this.entriesSnapshot
  }

  /** 读路由:id → 所属数据源(条目重载时重建);尚未见过的条目返回 undefined */
  getEntrySource(id: string): LibrarySource | undefined {
    return this.entrySourceMap.get(id)
  }

  private refreshSnapshot(): void {
    void this.listEntries().then(
      (list) => {
        this.entriesSnapshot = list
      },
      (err) => {
        console.warn('[assetLibrary] 条目快照刷新失败', err)
      },
    )
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    this.refreshSnapshot()
    this.listeners.forEach((fn) => fn())
  }

  /** 所有写操作串行化:删除/清理与导入不会交错扫描引用 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * 聚合列条目:合并各源。同 id 先注册者胜并上告 conflict;
   * 可写源里的内置前缀条目(seed-pose- 与 seed-model- 开头)剔除并上告
   * conflict——内置数据由内置目录源提供,可写源不得侵占其命名空间。
   */
  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const byId = new Map<string, LibraryEntry>()
    const srcById = new Map<string, LibrarySource>()
    for (const src of this.sources) {
      let list: LibraryEntry[]
      try {
        list = await src.listEntries(kind)
      } catch (err) {
        this.onError?.(
          new LibraryError('unknown', `数据源 ${src.id} 条目列表读取失败`, err),
        )
        continue
      }
      for (const entry of list) {
        if (src === this.writable && isBuiltinId(entry.id)) {
          this.onError?.(
            new LibraryError(
              'conflict',
              `可写源不允许内置前缀条目:${entry.id}`,
            ),
          )
          continue
        }
        if (byId.has(entry.id)) {
          this.onError?.(
            new LibraryError('conflict', `条目 id 冲突:${entry.id}`),
          )
          continue
        }
        byId.set(entry.id, entry)
        srcById.set(entry.id, src)
      }
    }
    this.entrySourceMap = srcById
    return [...byId.values()]
  }

  /**
   * 聚合读条目:映射命中直接走所属源;快照未覆盖(刚写入尚未回刷)时
   * 按注册顺序探源,先命中者胜(与 listEntries 的先注册者胜一致)。
   */
  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    const mapped = this.entrySourceMap.get(id)
    if (mapped) return mapped.getEntry(id)
    for (const src of this.sources) {
      const entry = await src.getEntry(id)
      if (entry) return entry
    }
    return undefined
  }

  /**
   * blobId 路由规则:含 ':' → 前缀即源 id,整串交给该源自解析
   * (静态源→CDN 地址,IDB→blob:,HTTP→预签名);裸 hash → 可写源。
   */
  async getBlobUrl(blobId: string): Promise<string> {
    const colon = blobId.indexOf(':')
    if (colon > 0) {
      const src = this.sources.find((s) => s.id === blobId.slice(0, colon))
      if (src) return src.getBlobUrl(blobId)
    }
    if (this.writable) return this.writable.getBlobUrl(blobId)
    throw new LibraryError('not-found', `无法解析 blob:${blobId}`)
  }

  private requireWritable(): WritableLibrarySource {
    if (!this.writable) {
      throw new LibraryError('auth', '纯查看器模式:未配置可写存储')
    }
    return this.writable
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    await this.enqueue(async () => {
      await this.requireWritable().putEntry(entry)
      this.emit()
    })
  }

  async deleteEntry(id: string): Promise<void> {
    await this.enqueue(async () => {
      await this.requireWritable().deleteEntry(id)
      this.emit()
    })
  }

  async renameEntry(id: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      const entry = await this.getEntry(id)
      if (!entry) return
      await this.requireWritable().putEntry({...entry, name})
      this.emit()
    })
  }

  /** 原子写入 blob + 条目(导入/缩略图共用):与删除/清理串行,引用不会被并发误删 */
  async putBlobWithEntry(
    data: Blob,
    makeEntry: (blobId: string) => LibraryEntry,
  ): Promise<void> {
    await this.enqueue(async () => {
      const writable = this.requireWritable()
      const blobId = await writable.putBlob(data)
      await writable.putEntry(makeEntry(blobId))
      this.emit()
    })
  }

  /** 仅写 blob(预览图稍后挂条目的播种场景):串行进写队列,孤儿清扫不会插队 */
  async putBlob(data: Blob): Promise<string> {
    return this.enqueue(async () => this.requireWritable().putBlob(data))
  }

  /** 可写源的 blob 清单;无可写源或源不实现清单(HTTP 源)时返回空 */
  async listBlobIds(): Promise<string[]> {
    return (await this.writable?.listBlobIds?.()) ?? []
  }

  /** 所有条目引用的 blob id 集合(模型 blobId + thumbnailId) */
  private async referencedBlobIds(): Promise<Set<string>> {
    const entries = await this.listEntries()
    const ids = new Set<string>()
    for (const e of entries) {
      if ('blobId' in e) ids.add(e.blobId)
      // thumbnailId 不再是模型专属(2026-10-05 起姿势条目也挂预览图),
      // 结构性判断:有字段且非空就算引用,否则启动清扫会把手势预览图
      // 当孤儿删掉(条目还在、图没了)
      if ('thumbnailId' in e && e.thumbnailId) ids.add(e.thumbnailId)
    }
    return ids
  }

  /** 删条目并清理它的 blob;blob 被其他条目共享时保留 */
  async deleteEntryDeep(id: string): Promise<void> {
    await this.enqueue(async () => {
      const entry = await this.getEntry(id)
      if (!entry) return
      const writable = this.requireWritable()
      const own: string[] = []
      if ('blobId' in entry) own.push(entry.blobId)
      if ('thumbnailId' in entry && entry.thumbnailId)
        own.push(entry.thumbnailId)
      await writable.deleteEntry(id)
      const referenced = await this.referencedBlobIds()
      for (const blobId of own) {
        if (!referenced.has(blobId)) await writable.deleteBlob(blobId)
      }
      this.emit()
    })
  }

  /** 清理无条目引用的孤儿 blob,返回删除数量 */
  async sweepOrphanBlobs(): Promise<number> {
    return this.enqueue(async () => {
      const writable = this.writable
      // 纯查看器模式 / HTTP 源等不实现清单:跳过清扫(source.ts 约定)
      if (!writable?.listBlobIds) return 0
      const referenced = await this.referencedBlobIds()
      const all = await writable.listBlobIds()
      let n = 0
      for (const id of all) {
        if (!referenced.has(id)) {
          await writable.deleteBlob(id)
          n++
        }
      }
      return n
    })
  }

  /** 直读骨架族别名(透传可写源,不 emit);纯查看器模式返回空表 */
  getRigAliases(): Promise<RigAlias[]> {
    return this.writable?.getRigAliases() ?? Promise.resolve([])
  }

  /** 设置/覆盖骨架族别名 */
  async setRigAlias(rig: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      await this.requireWritable().putRigAlias({rig, name})
      this.emit()
    })
  }
}

function isBuiltinId(id: string): boolean {
  return BUILTIN_ID_PREFIXES.some((p) => id.startsWith(p))
}

let singleton: Library | undefined

/** 库单例:playground 固定用 IndexedDB 实现 */
export function getLibrary(): Library {
  if (!singleton) {
    const idb = new IndexedDBBackend()
    singleton = new Library({sources: [idb]})
    // 启动时清理孤儿 blob(上次导入中断等留下的),失败不阻塞
    void singleton.sweepOrphanBlobs().catch((err) => {
      console.warn('[assetLibrary] 孤儿 blob 清理失败', err)
    })
  }
  return singleton
}

/** bootstrap 用:按宿主配置重建单例(T8 接线) */
export function configureLibrary(opts: LibraryOpts): Library {
  singleton = new Library(opts)
  return singleton
}

/** 订阅式读库条目:导入/删除/重命名后自动刷新 */
export function useLibraryEntries(kind?: EntryKind): LibraryEntry[] {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  useEffect(() => {
    let alive = true
    const reload = () => {
      void getLibrary()
        .listEntries(kind)
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

/** 订阅式读骨架族别名:rig → 名字;改名后自动刷新 */
export function useRigAliases(): Record<string, string> {
  const [aliases, setAliases] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    const reload = () => {
      void getLibrary()
        .getRigAliases()
        .then((list) => {
          if (alive)
            setAliases(Object.fromEntries(list.map((a) => [a.rig, a.name])))
        })
    }
    reload()
    const unsub = getLibrary().subscribe(reload)
    return () => {
      alive = false
      unsub()
    }
  }, [])
  return aliases
}
