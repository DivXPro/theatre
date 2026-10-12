import {useEffect, useState} from 'react'
import {IndexedDBBackend} from './indexedDBBackend'
import {isWritableSource, LibraryError} from './source'
import type {LibrarySource, WritableLibrarySource} from './source'
import {StaticCatalogSource} from './staticCatalogSource'
import {seedAssetsManifest} from './seedAssetsManifest'
import type {EntryKind, LibraryEntry, RigAlias} from './types'

export type LibraryOpts = {
  sources: LibrarySource[]
  writable?: WritableLibrarySource
  onError?: (err: LibraryError) => void
}

/** 内置目录条目的保留 id 前缀:出现在可写源即剔除并告警(内置数据只读) */
const BUILTIN_ID_PREFIXES = ['seed-pose-', 'seed-model-']

/** 内置骨架族(Mixamo 角色同一套骨骼命名)的默认别名 */
export const SEED_RIG_ALIAS = 'Mixamo'

/**
 * 内置目录骨架族的默认别名表:getRigAliases 的并集读与
 * ensureBuiltinRigAlias 的写保底共用这一份事实源(rig 集合只从
 * seedAssetsManifest 派生一次,两个出口不许各写一份)
 */
const BUILTIN_RIG_ALIASES: RigAlias[] = seedAssetsManifest.models.map((m) => ({
  rig: m.rig,
  name: SEED_RIG_ALIAS,
}))

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
    // 源 id 撞名守卫(终审 M-5;宿主源撞内置保留名 'catalog'/'idb' 同理):
    // 上告 conflict 一次,行为维持先注册者胜——blobId 前缀路由按注册序
    // find 首个匹配,不抛、不换源
    const seenSourceIds = new Set<string>()
    for (const src of opts.sources) {
      if (seenSourceIds.has(src.id)) {
        this.onError?.(
          new LibraryError('conflict', `数据源 id 冲突:${src.id}(先注册者胜)`),
        )
      } else {
        seenSourceIds.add(src.id)
      }
    }
    this.refreshSnapshot()
  }

  /** 纯查看器模式(无可写源)为 false:宿主应隐藏导入/删除/保存姿势入口 */
  get canWrite(): boolean {
    return this.writable !== undefined
  }

  /**
   * 运行时错误上告通道(资产加载失败等非聚合错误):透传给构造时的
   * onError;未配置则静默(调用方自己 console.warn)。聚合读失败
   * (listEntries 单源出错)走内部直发,不经过这里。
   */
  reportError(err: LibraryError): void {
    this.onError?.(err)
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
   *
   * 模型条目(kind 'model')额外按 contentHash 去重(2026-10-12 修复轮
   * R11):旧浏览器 IDB 里已播种的模型与目录源同一模型会在选择框里成双,
   * 故同一内容只列一份;可写源副本优先(用户的条目 id 保留,场景引用
   * 不断),与注册顺序无关。只去重列表,不删数据——getEntry 对两个 id
   * 都仍解析。姿势/动画维持 id 去重,不按 contentHash。
   */
  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const byId = new Map<string, LibraryEntry>()
    const srcById = new Map<string, LibrarySource>()
    // 模型内容哈希 → 当前持有该哈希条目的 id,用于跨源去重后定位替换
    const modelIdByHash = new Map<string, string>()
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
        // 模型按 contentHash 去重:已收同哈希条目时,可写源副本顶替
        // (保留可写源 id),否则丢弃当前副本;姿势/动画不进此分支。
        // 无 contentHash 的模型条目跳过哈希去重——否则两个无哈希条目会
        // 在 'undefined' 键上相撞、第二个被静默丢弃;它们照常各列各的。
        if (entry.kind === 'model' && entry.contentHash) {
          const heldId = modelIdByHash.get(entry.contentHash)
          if (heldId !== undefined) {
            const heldSrc = srcById.get(heldId)
            const writableWins =
              src === this.writable && heldSrc !== this.writable
            if (writableWins) {
              byId.delete(heldId)
              srcById.delete(heldId)
              byId.set(entry.id, entry)
              srcById.set(entry.id, src)
              modelIdByHash.set(entry.contentHash, entry.id)
            }
            // 非可写源顶替(可写源已持该哈希,或两个只读源撞哈希):
            // 丢弃当前副本,先收者/可写源保留
            continue
          }
          modelIdByHash.set(entry.contentHash, entry.id)
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
   * 映射命中但所属源已删该 id 时(升级首启清理竞态:删 seed-pose-*
   * 后、下次 listEntries 重建映射前的毫秒窗口)落回同一探源循环,
   * 不让缓存型消费者(姿势预取)整会话解析失败。
   */
  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    const mapped = this.entrySourceMap.get(id)
    if (mapped) {
      const entry = await mapped.getEntry(id)
      if (entry) return entry
    }
    for (const src of this.sources) {
      const entry = await src.getEntry(id)
      if (entry) {
        // 探源命中回填冷映射:renameEntry 的只读源守卫走 getEntrySource,
        // 未 listEntries 的冷会话里映射是空的,缺这一行会绕过守卫、
        // 给内置条目写进可写源影子副本(T9 顺带,T8 评审遗留)
        this.entrySourceMap.set(id, src)
        return entry
      }
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
      // 只读源(内置目录等)条目不写影子副本进可写源:重命名是用户库
      // 行为,对内置条目上告 conflict 并原样保留(2026-10-12 T5 评审遗留)
      const src = this.getEntrySource(id)
      if (src !== undefined && src !== this.writable) {
        this.reportError(
          new LibraryError('conflict', `只读源条目不可重命名:${id}`),
        )
        return
      }
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

  /**
   * 直读骨架族别名:内置默认别名 ∪ 可写源别名,可写源同名覆盖(不 emit)。
   * 别名属目录数据、写宿主存储本就不妥,读侧并集让宿主存储与纯查看器
   * 模式下内置 Mixamo 族名照常显示,不截断哈希(终审 M-4)
   */
  async getRigAliases(): Promise<RigAlias[]> {
    const byRig = new Map<string, string>()
    for (const a of BUILTIN_RIG_ALIASES) byRig.set(a.rig, a.name)
    if (this.writable) {
      for (const a of await this.writable.getRigAliases())
        byRig.set(a.rig, a.name)
    }
    return [...byRig.entries()].map(([rig, name]) => ({rig, name}))
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

/**
 * 内置目录骨架族的默认别名保底:旧播种流程在 seedModels 里设置,
 * 去播种(2026-10-10 目录化)后由这里补一次;用户已起过名的不覆盖。
 * bootstrap 的缺省 IDB 启动分支调(T9 顺带,与单例内建那份同一语义)。
 * 注意读的是可写源自有列表而非并集:getRigAliases 的并集读永远含
 * 内置默认,「要不要写保底」按并集判断会失真(保底永不写入)
 */
export async function ensureBuiltinRigAlias(lib: Library): Promise<void> {
  const aliased = new Set(
    (await (lib.writable?.getRigAliases() ?? Promise.resolve([]))).map(
      (a) => a.rig,
    ),
  )
  for (const alias of BUILTIN_RIG_ALIASES) {
    if (aliased.has(alias.rig)) continue
    aliased.add(alias.rig)
    await lib.setRigAlias(alias.rig, alias.name)
  }
}

/**
 * 库单例:playground 缺省 = IndexedDB 可写源 + 内置目录只读源
 * (StaticCatalogSource,随包 GLB/预览图;T8 起宿主可经 configureLibrary
 * 覆盖整套源)。目录条目的运行时缩略图渲染器走 catalogThumbs——
 * 动态 import 保持模块图轻(避免 library ⇄ poseThumbnail 环)且
 * jest 下只有真实渲染路径才求值。
 */
export function getLibrary(): Library {
  if (!singleton) {
    const idb = new IndexedDBBackend()
    const catalog = new StaticCatalogSource({
      renderPoseThumb: (entry): Promise<string | undefined> =>
        import('./catalogThumbs').then((m) =>
          m.renderCatalogPoseThumb(catalog, entry),
        ),
      renderModelThumb: (entry): Promise<string | undefined> =>
        import('./catalogThumbs').then((m) =>
          m.renderCatalogModelThumb(catalog, entry),
        ),
    })
    singleton = new Library({sources: [idb, catalog]})
    // 启动时清理孤儿 blob(上次导入中断等留下的),失败不阻塞
    void singleton.sweepOrphanBlobs().catch((err) => {
      console.warn('[assetLibrary] 孤儿 blob 清理失败', err)
    })
    void ensureBuiltinRigAlias(singleton).catch((err) => {
      console.warn('[assetLibrary] 内置骨架族别名设置失败', err)
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
