// packages/camera-studio/src/assetLibrary/staticCatalogSource.ts
/**
 * 内置资产目录源(2026-10-10 内置资产目录化):随包发布的模型 GLB 与
 * 姿势预览图,以只读 LibrarySource 形式并入聚合器——与宿主生产存储、
 * 本地 IndexedDB 同一接口,零特判。
 *
 * - 条目来自入库清单(seedAssetsManifest,脚本生成)+ 姿势数据模块;
 *   内置模型 id = seed-model-<contentHash>,姿势 id 保持 seed-pose-* 不变。
 * - blobId 全部带 `catalog:` 前缀,聚合器按前缀路由回本源:
 *     catalog:models/<file>        → baseUrl 静态文件(纯拼接,不探测)
 *     catalog:poseThumbs/<file>    → 同上(QBX 手势源包预览图)
 *     catalog:runtime/model/<key>  → 注入的 renderModelThumb(内存缓存)
 *     catalog:runtime/pose/<id>    → 注入的 renderPoseThumb(内存缓存)
 * - baseUrl 缺省惰性解析到包内 assets/(jest 不碰:测试一律显式注入)。
 */
import {LibraryError} from './source'
import type {LibrarySource} from './source'
import {buildBuiltinPoseEntries, builtinPoseRig} from './seedBuiltinPoses'
import {seedAssetsManifest} from './seedAssetsManifest'
import type {SeedAssetsManifest} from './seedAssetsManifest'
import type {EntryKind, LibraryEntry, ModelEntry, PoseEntry} from './types'

/** 运行时缩略图渲染器:返回可用 URL(blob:/data:),渲染不了返回 undefined */
export type CatalogThumbRenderer<E extends LibraryEntry> = (
  entry: E,
) => Promise<string | undefined>

export type StaticCatalogSourceOpts = {
  /** 资产文件根(以 / 结尾);缺省惰性取包内 assets/ */
  baseUrl?: string
  /** 缺省 = 入库的 seedAssetsManifest(测试可注入缩窄版) */
  manifest?: SeedAssetsManifest
  /**
   * 预留:宿主自定义取数(代理/鉴权 CDN)时用。源自身不发起网络——
   * 静态文件纯拼 URL 交给 <img>/GLTFLoader 直接取,运行时缩略图由
   * 注入的渲染器自行取数;当前实现不读取此字段。
   */
  fetcher?: typeof fetch
  renderPoseThumb?: CatalogThumbRenderer<PoseEntry>
  renderModelThumb?: CatalogThumbRenderer<ModelEntry>
}

const PREFIX = 'catalog:'

/**
 * 包内 assets/ 的缺省根:src/assetLibrary/ 与 dist/assetLibrary/ 同层深,
 * 两种形态都指到包根 assets/。必须惰性调用——import.meta.url 在 jest
 * (CJS 变换)下不可用,模块加载期求值会让整条 import 链崩掉。
 */
function defaultBaseUrl(): string {
  return new URL('../../assets/', import.meta.url).href
}

export class StaticCatalogSource implements LibrarySource {
  readonly id = 'catalog'
  readonly capabilities = {writable: false, permanentUrls: true} as const

  private readonly manifest: SeedAssetsManifest
  private readonly renderPoseThumb?: CatalogThumbRenderer<PoseEntry>
  private readonly renderModelThumb?: CatalogThumbRenderer<ModelEntry>
  private readonly optsBaseUrl?: string
  private resolvedBaseUrl?: string
  private entriesById?: Map<string, LibraryEntry>
  /** 运行时缩略图 URL 缓存:渲染是 WebGL 离屏,同一 blobId 只渲染一次 */
  private runtimeUrlCache = new Map<string, Promise<string>>()

  constructor(opts: StaticCatalogSourceOpts = {}) {
    this.manifest = opts.manifest ?? seedAssetsManifest
    this.renderPoseThumb = opts.renderPoseThumb
    this.renderModelThumb = opts.renderModelThumb
    this.optsBaseUrl = opts.baseUrl
  }

  private baseUrl(): string {
    if (!this.resolvedBaseUrl) {
      const raw = this.optsBaseUrl ?? defaultBaseUrl()
      this.resolvedBaseUrl = raw.endsWith('/') ? raw : raw + '/'
    }
    return this.resolvedBaseUrl
  }

  private buildEntries(): Map<string, LibraryEntry> {
    const byId = new Map<string, LibraryEntry>()
    const thumbFileByKey = new Map(
      this.manifest.poseThumbs.map((t) => [t.key, t.file]),
    )
    for (const m of this.manifest.models) {
      const entry: ModelEntry = {
        id: `seed-model-${m.contentHash}`,
        kind: 'model',
        name: m.name,
        rig: m.rig,
        blobId: `${PREFIX}models/${m.file}`,
        contentHash: m.contentHash,
        thumbnailId: `${PREFIX}runtime/model/${m.key}`,
        boneCount: m.boneCount,
        vertexCount: m.vertexCount,
        // 内置条目 createdAt 恒 0:目录内容静态,固定值保证 id/排序稳定
        createdAt: 0,
      }
      byId.set(entry.id, entry)
    }
    for (const p of buildBuiltinPoseEntries(builtinPoseRig(this.manifest))) {
      const key = p.id.slice('seed-pose-'.length)
      const thumbFile = thumbFileByKey.get(key)
      byId.set(p.id, {
        ...p,
        thumbnailId: thumbFile
          ? `${PREFIX}poseThumbs/${thumbFile}`
          : `${PREFIX}runtime/pose/${p.id}`,
      })
    }
    return byId
  }

  private entries(): Map<string, LibraryEntry> {
    return (this.entriesById ??= this.buildEntries())
  }

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const all = [...this.entries().values()]
    return kind ? all.filter((e) => e.kind === kind) : all
  }

  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    return this.entries().get(id)
  }

  /**
   * blob 路由:静态文件纯拼 baseUrl(不探测可达性——配错由加载方
   * 包 LibraryError('network') 上告,见 PlacementManager);运行时
   * 缩略图调注入渲染器,结果按 blobId 内存缓存(不落地)。
   */
  async getBlobUrl(blobId: string): Promise<string> {
    if (!blobId.startsWith(PREFIX)) {
      throw new LibraryError('not-found', `非内置目录 blob:${blobId}`)
    }
    const rest = blobId.slice(PREFIX.length)
    if (rest.startsWith('models/') || rest.startsWith('poseThumbs/')) {
      // 逐段编码:文件名可含空格('Y Bot.glb'),目录段不动
      return this.baseUrl() + rest.split('/').map(encodeURIComponent).join('/')
    }
    if (rest.startsWith('runtime/model/')) {
      const key = rest.slice('runtime/model/'.length)
      // key 对上清单条目才认(渲染器按条目渲染,不认裸 key)
      const asset = this.manifest.models.find((m) => m.key === key)
      const entry = asset
        ? this.entries().get(`seed-model-${asset.contentHash}`)
        : undefined
      if (!this.renderModelThumb || !entry || entry.kind !== 'model') {
        throw new LibraryError(
          'not-found',
          `模型缩略图不可用(缺渲染器或未知条目):${blobId}`,
        )
      }
      return this.cachedRuntime(blobId, () =>
        this.renderModelThumb!(entry as ModelEntry),
      )
    }
    if (rest.startsWith('runtime/pose/')) {
      const id = rest.slice('runtime/pose/'.length)
      const entry = this.entries().get(id)
      if (!this.renderPoseThumb || !entry || entry.kind !== 'pose') {
        throw new LibraryError(
          'not-found',
          `姿势缩略图不可用(缺渲染器或未知条目):${blobId}`,
        )
      }
      return this.cachedRuntime(blobId, () =>
        this.renderPoseThumb!(entry as PoseEntry),
      )
    }
    throw new LibraryError('not-found', `未知内置目录 blob:${blobId}`)
  }

  private cachedRuntime(
    blobId: string,
    render: () => Promise<string | undefined>,
  ): Promise<string> {
    let cached = this.runtimeUrlCache.get(blobId)
    if (!cached) {
      cached = render().then((url) => {
        if (!url) {
          // 渲染不可用(GL 缺失等):不缓存,下次重试;按 not-found 降级
          this.runtimeUrlCache.delete(blobId)
          throw new LibraryError('not-found', `缩略图渲染不可用:${blobId}`)
        }
        return url
      })
      this.runtimeUrlCache.set(blobId, cached)
      // 注入渲染器自身抛错也不缓存(瞬时故障可重试)
      cached.catch(() => this.runtimeUrlCache.delete(blobId))
    }
    return cached
  }
}
