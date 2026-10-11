import type {WritableLibrarySource} from './source'

/** 骨架族 id(rigIdOf 生成);无骨架模型为 'static' */
export type RigId = string

/** 骨架族别名:给人看的名字,面板骨架标签显示 */
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
  /** 缩略图 blob id(QBX 手势:源包内嵌预览图,管线期导出随包播种) */
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

/**
 * 库的存储适配接口:playground 用 IndexedDB 实现,应用层可换 HTTP
 * 实现。大二进制以 URL 形式暴露(本地 blob: / 远程 CDN 地址),
 * blobId = 内容哈希,天然支持去重。
 *
 * @deprecated 统一数据源后的兼容别名,新代码用 WritableLibrarySource
 */
export type LibraryBackend = WritableLibrarySource
