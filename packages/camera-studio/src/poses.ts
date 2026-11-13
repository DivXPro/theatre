/**
 * 内置静态姿势库的公开入口(包根与 `@dreamerbird/camera-studio/poses`
 * 子路径同时导出)。
 *
 * 姿势数据随包编译进 JS,不依赖 IndexedDB / 网络 / React。引用本包的
 * 项目可以直接列出姿势、把 `entry.bones` 写进自己的 THREE 骨架,或交给
 * Agent API 的 `poses.applyCustom`。
 *
 * - id 稳定:`seed-pose-<key>`,与场景里已保存的姿势引用一致。
 * - rig 是内置族代表模型(Y Bot)的 Mixamo 骨架 id;导入同款 Mixamo
 *   模型得到的 rig 与之相等,跨项目可直接复用。
 * - QBX 手势条目只包含手指骨,是叠加片段,不覆盖身体姿势。
 */
import {applyPose, captureBindPose, capturePose} from './assetLibrary/pose'
import {
  buildBuiltinPoseEntries,
  builtinPoseRig,
} from './assetLibrary/seedBuiltinPoses'
import type {PoseEntry} from './assetLibrary/types'

export {applyPose, captureBindPose, capturePose}

/** 内置姿势所属骨架族(内置 Y Bot 的 rig id) */
export const BUILTIN_POSE_RIG = builtinPoseRig()

/** 内置姿势数据来源,用于署名/展示;不影响运行时行为 */
export const BUILTIN_POSE_SOURCES = [
  {id: 'procedural', name: '内置程序化基础姿势'},
  {id: 'dpl', name: 'Dynamic Pose Library Free (BlendAtlas)'},
  {id: 'qbx', name: 'QBX Pose Asset Pack'},
] as const

export type BuiltinPoseSourceId = (typeof BUILTIN_POSE_SOURCES)[number]['id']

let entriesById: Map<string, PoseEntry> | undefined

/**
 * 列出全部内置静态姿势。返回的条目是包内共享的只读数据,请勿原地修改;
 * 需要改骨骼时先拷贝 `bones`。
 */
export function listBuiltinPoses(): PoseEntry[] {
  if (!entriesById) {
    const entries = buildBuiltinPoseEntries(BUILTIN_POSE_RIG)
    entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  }
  return [...entriesById.values()]
}

/** 按稳定 id 取内置姿势;未知 id 返回 undefined。 */
export function getBuiltinPose(id: string): PoseEntry | undefined {
  listBuiltinPoses()
  return entriesById!.get(id)
}
