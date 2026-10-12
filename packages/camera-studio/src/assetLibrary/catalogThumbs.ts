// packages/playground/src/shared/camera/assetLibrary/catalogThumbs.ts
/**
 * 内置目录条目的运行时缩略图渲染器(StaticCatalogSource 的默认注入):
 * 目录条目不落库存图——身体姿势/模型的缩略图按需从目录 GLB 离屏渲染,
 * 与旧播种后回填(poseThumbnail/thumbnail)同一套渲染实现。
 *
 * 惰性 + 缓存:模特 GLB 的 fetch/解析按条目缓存(渲染会话含 WebGL
 * 上下文,一个模特一份);单个姿势/模型的缩略图 URL 缓存由
 * StaticCatalogSource 自身承担,这里不重复缓存。
 * GL 不可用/取数失败:告警一次并缓存 null,之后安静降级为占位图标。
 */
import {createPoseThumbSession} from './poseThumbnail'
import type {PoseThumbSession} from './poseThumbnail'
import {renderThumbnail} from './thumbnail'
import type {StaticCatalogSource} from './staticCatalogSource'
import type {ModelEntry, PoseEntry} from './types'

/** 模特 GLB 字节缓存(按目录模型条目 id) */
const glbByEntryId = new Map<string, Promise<ArrayBuffer>>()

function fetchModelGlb(
  source: StaticCatalogSource,
  model: ModelEntry,
): Promise<ArrayBuffer> {
  let cached = glbByEntryId.get(model.id)
  if (!cached) {
    cached = source
      .getBlobUrl(model.blobId)
      .then((url) => fetch(url))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
    cached.catch(() => glbByEntryId.delete(model.id)) // 瞬时故障不缓存
    glbByEntryId.set(model.id, cached)
  }
  return cached
}

/** 姿势渲染会话缓存(按目录模型条目 id);失败缓存 null 并只告警一次 */
const sessionByEntryId = new Map<string, Promise<PoseThumbSession | null>>()

function poseSessionFor(
  source: StaticCatalogSource,
  model: ModelEntry,
): Promise<PoseThumbSession | null> {
  let cached = sessionByEntryId.get(model.id)
  if (!cached) {
    cached = fetchModelGlb(source, model)
      .then((glb) => createPoseThumbSession(glb))
      .catch((err) => {
        console.warn(
          `[assetLibrary] 内置姿势缩略图渲染会话创建失败(${model.name})`,
          err,
        )
        return null
      })
    sessionByEntryId.set(model.id, cached)
  }
  return cached
}

/** 同族第一个模型条目当「模特」(与回填 renderRigBatch 同规则) */
async function modelForRig(
  source: StaticCatalogSource,
  rig: string,
): Promise<ModelEntry | undefined> {
  const models = (await source.listEntries('model')) as ModelEntry[]
  return models.find((m) => m.rig === rig && m.blobId)
}

/** 身体姿势缩略图:目录模特 GLB 上套姿势离屏渲染,blob: URL 返回 */
export async function renderCatalogPoseThumb(
  source: StaticCatalogSource,
  entry: PoseEntry,
): Promise<string | undefined> {
  const model = await modelForRig(source, entry.rig)
  if (!model) return undefined
  const session = await poseSessionFor(source, model)
  if (!session) return undefined
  const blob = await session.render(entry.bones)
  return blob ? URL.createObjectURL(blob) : undefined
}

/** 模型缩略图:目录 GLB 直接离屏渲染(复用导入管线的 renderThumbnail) */
export async function renderCatalogModelThumb(
  source: StaticCatalogSource,
  entry: ModelEntry,
): Promise<string | undefined> {
  let glb: ArrayBuffer
  try {
    glb = await fetchModelGlb(source, entry)
  } catch (err) {
    console.warn(`[assetLibrary] 内置模型 GLB 拉取失败(${entry.name})`, err)
    return undefined
  }
  const blob = await renderThumbnail(glb)
  return blob ? URL.createObjectURL(blob) : undefined
}
