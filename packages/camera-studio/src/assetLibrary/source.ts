/**
 * 统一数据源(2026-10-10 spec §5):模型/姿势/动画数据完全由应用提供的
 * 存储承担;模块附带的基础资产也走同一接口——一个接口、三种实现
 * (内置目录 / 宿主生产存储 / 本地 IndexedDB 演示),零特判。
 */
import type {EntryKind, LibraryEntry, RigAlias} from './types'

export type LibraryErrorCode =
  | 'auth'
  | 'quota'
  | 'network'
  | 'conflict'
  | 'not-found'
  | 'unknown'

export class LibraryError extends Error {
  constructor(
    readonly code: LibraryErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

/** 源能力自描述(供 capabilities 查询;可写判别以 putEntry 存在性为准) */
export type LibrarySourceCapabilities = {
  writable?: boolean
  permanentUrls?: boolean // URL 长效才允许跨挂载缓存
  maxUploadBytes?: number // 导入前先校验先提示
}

/** 统一数据源(读) */
export interface LibrarySource {
  readonly id: string
  listEntries(kind?: EntryKind): Promise<LibraryEntry[]>
  getEntry(id: string): Promise<LibraryEntry | undefined>
  /** 每个源自己解析自己的 blob:静态源→CDN 地址,HTTP 源→预签名,IDB→blob: */
  getBlobUrl(blobId: string): Promise<string>
  capabilities?: LibrarySourceCapabilities
  /** 远端变更推送(可选,v1 不强制) */
  subscribe?(fn: () => void): () => void
}

/** 可写源 = 用户库(宿主生产存储 / 内置 IDB) */
export interface WritableLibrarySource extends LibrarySource {
  putEntry(entry: LibraryEntry): Promise<void>
  deleteEntry(id: string): Promise<void>
  putBlob(
    data: Blob,
    opts?: {onProgress?: (ratio: number) => void; signal?: AbortSignal},
  ): Promise<string>
  deleteBlob(blobId: string): Promise<void>
  getRigAliases(): Promise<RigAlias[]>
  putRigAlias(alias: RigAlias): Promise<void>
  /** 孤儿清扫用;HTTP 源不实现则跳过清扫 */
  listBlobIds?(): Promise<string[]>
}

export function isWritableSource(s: LibrarySource): s is WritableLibrarySource {
  return typeof (s as WritableLibrarySource).putEntry === 'function'
}
