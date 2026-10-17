/**
 * 抽帧存姿势(2026-10-17,Task 9 抽离):CameraScene 的「保存姿势」菜单
 * 与 Agent `poses.saveCurrent` 共用的入库流程。
 *
 * rig 取库模型条目优先:GLB 导出会清洗骨骼名(如去掉 mixamorig:Hips
 * 中的 ':'),实例侧重算的 rig 与库模型条目记录的 rig 可能不一致;
 * 本地 FBX 路径或条目缺失时回退到实例计算(legacy,可能与库 rig 不一致
 * 但可接受)。静态骨架返回 undefined,不入库。
 *
 * 缩略图补图是后台旁路(运行时离屏渲染),失败只告警,不阻塞主流程。
 * 调用方负责:name 的来源(UI 弹 prompt / Agent 参数)与错误映射。
 */
import type {Object3D} from 'three'
import {capturePose} from '../assetLibrary/pose'
import {rigIdOf} from '../assetLibrary/rig'
import type {Library} from '../assetLibrary/library'
import type {PoseEntry} from '../assetLibrary/types'

export async function savePoseFromInstance(args: {
  library: Library
  instance: Object3D
  /** 放置条目的库模型条目 id;有则取其 rig 保证与来源模型匹配 */
  libraryEntryId?: string
  name: string
}): Promise<PoseEntry | undefined> {
  const {library, instance, libraryEntryId, name} = args
  let rig: string | undefined
  if (libraryEntryId) {
    const libEntry = await library.getEntry(libraryEntryId)
    if (libEntry?.kind === 'model') rig = libEntry.rig
  }
  if (!rig) rig = rigIdOf(instance)
  if (rig === 'static') return undefined
  const entry: PoseEntry = {
    id: 'lib-' + Math.random().toString(36).slice(2, 10),
    kind: 'pose',
    name,
    rig,
    bones: capturePose(instance),
    createdAt: Date.now(),
  }
  await library.putEntry(entry)
  // 自存姿势顺手补缩略图(运行时离屏渲染,后台进行,失败只告警)
  void import('../assetLibrary/poseThumbnail')
    .then((m) => m.backfillPoseThumbnails(library))
    .catch((err) => console.warn('[assetLibrary] 姿势缩略图补图失败', err))
  return entry
}
