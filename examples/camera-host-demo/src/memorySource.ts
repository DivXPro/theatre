/**
 * 内存版可写存储(集成指南 §3 的示例实现,与 demo 逐字一致、可整段拷贝)。
 *
 * 语义要点(与包内契约对齐,改动请先知会契约套件):
 * - putEntry = upsert:同 id 覆盖,不报错;
 * - putBlob 内容寻址:同内容两次返回同一 id(简化版用 FNV-1a,
 *   生产实现请换 SHA-256,保留「同内容同 id」契约即可);
 * - getEntry(不存在)返回 undefined,不抛;
 * - 演示简化:同 id 直接覆盖存(不省字节),没有跨会话持久化——
 *   刷新页面库即清空,这是刻意为之,生产 HTTP 实现不要学。
 *
 * 类型说明:条目/别名的形状照抄包内定义(包根暂未转出口这些类型,
 * 见指南「排错」一节);形状与包内逐字段一致,TS 结构化校验会在
 * `storage:` 传参与契约套件注册处兜底。
 */

// ---- 与包内 packages/camera-studio/src/assetLibrary/types.ts 一致 ----
export type RigId = string
export type RigAlias = {rig: RigId; name: string}
export type EntryKind = 'model' | 'pose' | 'animation'

export type ModelEntry = {
  id: string
  kind: 'model'
  name: string
  rig: RigId
  blobId: string
  contentHash: string
  thumbnailId?: string
  boneCount: number
  vertexCount: number
  createdAt: number
}

export type PoseEntry = {
  id: string
  kind: 'pose'
  name: string
  rig: RigId
  thumbnailId?: string
  bones: Record<
    string,
    {
      rotation?: [number, number, number, number]
      position?: [number, number, number]
    }
  >
  createdAt: number
}

export type AnimationEntry = {
  id: string
  kind: 'animation'
  name: string
  rig: RigId
  blobId: string
  contentHash: string
  duration: number
  createdAt: number
}

export type LibraryEntry = ModelEntry | PoseEntry | AnimationEntry
// ---- 类型拷贝结束 ----

/** FNV-1a 64 位:非加密,只做内容寻址(与包内 hashBytes 同算法) */
function fnv1a64(data: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i])
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export class MemorySource {
  readonly id = 'memory'
  readonly capabilities = {writable: true} as const

  private entries = new Map<string, LibraryEntry>()
  private blobs = new Map<string, Blob>()
  private urls = new Map<string, string>()
  private aliases = new Map<string, RigAlias>()

  async listEntries(kind?: EntryKind): Promise<LibraryEntry[]> {
    const all = [...this.entries.values()]
    return kind ? all.filter((e) => e.kind === kind) : all
  }

  async getEntry(id: string): Promise<LibraryEntry | undefined> {
    return this.entries.get(id)
  }

  async putEntry(entry: LibraryEntry): Promise<void> {
    this.entries.set(entry.id, entry)
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string> {
    const id = fnv1a64(new Uint8Array(await data.arrayBuffer()))
    this.blobs.set(id, data)
    // 内存写入瞬时完成,进度语义上直接报满
    opts?.onProgress?.(1)
    return id
  }

  async getBlobUrl(blobId: string): Promise<string> {
    const cached = this.urls.get(blobId)
    if (cached) return cached
    const blob = this.blobs.get(blobId)
    if (!blob) throw new Error(`blob 不存在: ${blobId}`)
    const url = URL.createObjectURL(blob)
    this.urls.set(blobId, url)
    return url
  }

  async deleteBlob(blobId: string): Promise<void> {
    const url = this.urls.get(blobId)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(blobId)
    this.blobs.delete(blobId)
  }

  async getRigAliases(): Promise<RigAlias[]> {
    return [...this.aliases.values()]
  }

  async putRigAlias(alias: RigAlias): Promise<void> {
    this.aliases.set(alias.rig, alias)
  }

  async listBlobIds(): Promise<string[]> {
    return [...this.blobs.keys()]
  }
}
