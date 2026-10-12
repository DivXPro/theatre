// packages/camera-studio/src/poseMode/poseOverride.ts
/**
 * poseOverride:摆姿势退出时内联写进 theatre 对象的骨骼状态(JSON 字符串)。
 * 优先级高于库姿势 poseId、低于什么都不写的绑定姿势兜底:
 *   effectivePoseBones = poseOverride ?? 库姿势 ?? 绑定姿势
 * 刷新/撤销重做/多端同步都走 theatre 属性通道,无需额外处理。
 */
import type {PoseEntry} from '../assetLibrary/types'

export type PoseBones = PoseEntry['bones']

export function stringifyPoseOverride(bones: PoseBones): string {
  return JSON.stringify(bones)
}

let warned = false

/** 空串/坏 JSON/非对象都回 null(手改坏或同步损坏时回退库姿势,不崩画布) */
export function parsePoseOverride(json: string): PoseBones | null {
  if (!json) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as PoseBones
  } catch {
    if (!warned) {
      warned = true
      console.warn(
        '[poseMode] poseOverride JSON 解析失败,回退到库姿势/绑定姿势',
      )
    }
    return null
  }
}

export function effectivePoseBones(
  overrideJson: string,
  poseBones: PoseBones | null,
  bindPose: PoseBones,
): PoseBones {
  return parsePoseOverride(overrideJson) ?? poseBones ?? bindPose
}
