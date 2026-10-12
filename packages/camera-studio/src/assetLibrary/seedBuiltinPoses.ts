// packages/camera-studio/src/assetLibrary/seedBuiltinPoses.ts
/**
 * 内置姿势条目构建(2026-10-10 内置资产目录化后):三批来源的数据模块
 *   - seedPoses:12 个程序化基础姿势(blender_dump.py 按方向摆 metarig)
 *   - seedPosesDpl:58 个 Dynamic Pose Library 姿势(blender_dump_dpl.py
 *     读 BlendAtlas 免费姿势包 .blend,含手指映射)
 *   - seedPosesQbx:110 个 QBX 手势(blender_dump_qbx.py 读 QBX 免费姿势包
 *     的 03_Hands 目录,仅手指骨的叠加片段:基础/其他/手势/持握 × 左右手)
 *
 * 去播种后,这些条目不再写入用户库,而是由 StaticCatalogSource 以
 * 只读目录形式提供;条目 id 保持 seed-pose-<key> 不变(旧场景按 id 引用,
 * 硬约束)。姿势的 rig 绑清单里族代表模型(Y Bot)的 rig——该值由生成
 * 脚本用运行时同一 rigIdOf(FBX 解析)算出,用户导入同款 Mixamo 模型
 * 得到的 rig 与之相等,姿势族匹配不断。
 *
 * seedBuiltinPosesInto 保留为测试夹具:把内置姿势写进传入的库(含
 * 预览图拉取入库逻辑),生产代码不再调用。
 */
import {seedPoses} from './seedPoses'
import {seedPosesDpl} from './seedPosesDpl'
import {seedPosesQbx} from './seedPosesQbx'
import {seedAssetsManifest} from './seedAssetsManifest'
import type {SeedAssetsManifest} from './seedAssetsManifest'
import type {Library} from './library'
import type {ModelEntry, PoseEntry} from './types'

const SEED_RIG_MODEL_NAME = 'Y Bot'
const MAX_WAIT_MS = 15000
const RETRY_MS = 500

/** 内置姿势所属骨架族:清单里族代表模型(Y Bot)的 rig */
export function builtinPoseRig(
  manifest: SeedAssetsManifest = seedAssetsManifest,
): string {
  const rep = manifest.models.find((m) => m.name === SEED_RIG_MODEL_NAME)
  if (!rep) {
    throw new Error(
      `[assetLibrary] 资产清单缺族代表模型:${SEED_RIG_MODEL_NAME}`,
    )
  }
  return rep.rig
}

/**
 * 内置姿势条目清单(不带缩略图):id 稳定(seed-pose-<key>),rig 缺省取
 * 清单族代表模型的 rig。StaticCatalogSource 与 seedBuiltinPosesInto 共用;
 * 缩略图由各自调用方按自己的存储语义挂(catalog 静态文件/运行时渲染,
 * 或播种时拉取入 blob)。
 */
export function buildBuiltinPoseEntries(
  rig: string = builtinPoseRig(),
): PoseEntry[] {
  const all = [...seedPoses, ...seedPosesDpl, ...seedPosesQbx]
  return all.map((p) => ({
    id: 'seed-pose-' + p.key,
    kind: 'pose',
    name: p.name,
    rig,
    bones: p.bones,
    // 内置条目 createdAt 恒 0:目录内容静态,时间戳无意义;固定值保证
    // 清单稳定(每次构建字节一致),排序语义上沉底为「最旧」
    createdAt: 0,
  }))
}

type Lib = Pick<Library, 'listEntries' | 'listBlobIds' | 'putBlob' | 'putEntry'>

/**
 * 播种核心(测试夹具,可注入):返回播种条数,0=未找到族代表模型。
 * 条目 id 稳定(seed-pose-<key>),putEntry upsert 语义,重复播种安全。
 *
 * opts.thumbs:QBX 手势预览图 URL 表(key → url)。条目尚无 thumbnailId
 * 时拉取 PNG 存 blob 并挂到条目上;已有 thumbnailId 的跳过(内容哈希
 * 去重,重复播种不会翻倍存储)。拉取/存 blob 失败只告警,姿势本体照播。
 */
export async function seedBuiltinPosesInto(
  lib: Lib,
  opts: {
    retryMs?: number
    maxWaitMs?: number
    sleep?: (ms: number) => Promise<void>
    thumbs?: Record<string, string>
  } = {},
): Promise<number> {
  const {retryMs = RETRY_MS, maxWaitMs = MAX_WAIT_MS, thumbs} = opts
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = Date.now() + maxWaitMs
  let rig: string | undefined
  while (Date.now() <= deadline) {
    const models = (await lib.listEntries('model')) as ModelEntry[]
    rig = models.find((m) => m.name === SEED_RIG_MODEL_NAME)?.rig
    if (rig) break
    await sleep(retryMs)
  }
  if (!rig) {
    console.warn(
      `[assetLibrary] 未找到 ${SEED_RIG_MODEL_NAME} 模型条目,内置姿势跳过播种`,
    )
    return 0
  }
  // 已播条目的 thumbnailId 先查一轮:补挂只发生在缺失时
  const existingThumbById = new Map<string, string>()
  let existingBlobIds: Set<string> | undefined
  if (thumbs) {
    for (const e of (await lib.listEntries('pose')) as PoseEntry[]) {
      if (e.thumbnailId) existingThumbById.set(e.id, e.thumbnailId)
    }
    // 引用了不存在 blob 的条目视为无图(曾被孤儿清扫误删等),触发重补
    existingBlobIds = new Set(await lib.listBlobIds())
  }
  const entries = buildBuiltinPoseEntries(rig)
  for (const entry of entries) {
    const key = entry.id.slice('seed-pose-'.length)
    let thumbnailId = existingThumbById.get(entry.id)
    if (thumbnailId && existingBlobIds && !existingBlobIds.has(thumbnailId)) {
      thumbnailId = undefined
    }
    const thumbUrl = thumbs?.[key]
    if (thumbUrl && !thumbnailId) {
      try {
        const res = await fetch(thumbUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        thumbnailId = await lib.putBlob(await res.blob())
      } catch (err) {
        console.warn(`[assetLibrary] 姿势预览图入库失败: ${key}`, err)
      }
    }
    await lib.putEntry({
      ...entry,
      createdAt: Date.now(),
      ...(thumbnailId ? {thumbnailId} : {}),
    })
  }
  return entries.length
}
