// packages/playground/src/shared/camera/assetLibrary/seedBuiltinPoses.ts
/**
 * 随包内置姿势播种(2026-10-02 内置姿势管线):把构建期产物写进资产库,
 * 姿势选择框开箱即有姿势可用。三批来源:
 *   - seedPoses:12 个程序化基础姿势(blender_dump.py 按方向摆 metarig)
 *   - seedPosesDpl:58 个 Dynamic Pose Library 姿势(blender_dump_dpl.py
 *     读 BlendAtlas 免费姿势包 .blend,含手指映射)
 *   - seedPosesQbx:110 个 QBX 手势(blender_dump_qbx.py 读 QBX 免费姿势包
 *     的 03_Hands 目录,仅手指骨的叠加片段:基础/其他/手势/持握 × 左右手),
 *     预览图同批随包(poseThumbsQbx/*.png,源包内嵌预览导出),播种时挂
 *     thumbnailId 到条目上供选择框显示
 *
 * 与模型播种(seedBuiltinModels)同模式:模块级幂等,失败只告警不阻塞。
 * rig 关联族代表 Y Bot 的模型条目(姿势是 Mixamo 骨架骨向换算产物);
 * 模型播种是异步的,这里轮询等它出现,超时放弃(下回挂载再试——
 * started 只在成功后置位)。
 */
import {getLibrary} from './library'
import type {Library} from './library'
import {seedPoses} from './seedPoses'
import {seedPosesDpl} from './seedPosesDpl'
import {seedPosesQbx} from './seedPosesQbx'
import type {ModelEntry, PoseEntry} from './types'

const SEED_RIG_MODEL_NAME = 'Y Bot'
const MAX_WAIT_MS = 15000
const RETRY_MS = 500

type Lib = Pick<Library, 'backend' | 'putEntry'>

let started = false

export function seedBuiltinPoses(): void {
  if (started) return
  started = true
  // 预览图 URL 表走动态 import:vite 的 import.meta.glob 在 jest 里不存在,
  // 静态引入会让 seedBuiltinPoses 的测试加载即崩;运行时(浏览器)才需要它
  void import('./poseThumbsQbxUrls')
    .then((m) =>
      seedBuiltinPosesInto(getLibrary(), {thumbs: m.qbxThumbUrlByKey}),
    )
    .then(async (count) => {
      // 失败(如 Y Bot 始终未播种)允许下次挂载重试
      if (count === 0) {
        started = false
        return
      }
      // 身体姿势缩略图:源包不在磁盘,运行时拿库内同族模型离屏渲染
      // 回填(QBX 手势图随包播种,不走这里);动态 import 保持 jest 安全
      const {backfillPoseThumbnails} = await import('./poseThumbnail')
      await backfillPoseThumbnails(getLibrary())
    })
    .catch((err) => {
      started = false
      console.warn('[assetLibrary] 内置姿势播种失败', err)
    })
}

/**
 * 播种核心(可注入,测试直接驱动):返回播种条数,0=未找到族代表模型。
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
    const models = (await lib.backend.listEntries('model')) as ModelEntry[]
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
    for (const e of (await lib.backend.listEntries('pose')) as PoseEntry[]) {
      if (e.thumbnailId) existingThumbById.set(e.id, e.thumbnailId)
    }
    // 引用了不存在 blob 的条目视为无图(曾被孤儿清扫误删等),触发重补
    existingBlobIds = new Set(await lib.backend.listBlobIds())
  }
  const all = [...seedPoses, ...seedPosesDpl, ...seedPosesQbx]
  for (const p of all) {
    const id = 'seed-pose-' + p.key
    let thumbnailId = existingThumbById.get(id)
    if (thumbnailId && existingBlobIds && !existingBlobIds.has(thumbnailId)) {
      thumbnailId = undefined
    }
    const thumbUrl = thumbs?.[p.key]
    if (thumbUrl && !thumbnailId) {
      try {
        const res = await fetch(thumbUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        thumbnailId = await lib.backend.putBlob(await res.blob())
      } catch (err) {
        console.warn(`[assetLibrary] 姿势预览图入库失败: ${p.key}`, err)
      }
    }
    await lib.putEntry({
      id,
      kind: 'pose',
      name: p.name,
      rig,
      bones: p.bones,
      ...(thumbnailId ? {thumbnailId} : {}),
      createdAt: Date.now(),
    })
  }
  return all.length
}
