import type {AnimationClip, Object3D} from 'three'
import {collectBoneNames, meshStats} from './rig'
import type {PoseEntry} from './types'

export type ModelClass =
  | 'model' // 网格+骨架(自带动画与否都算)
  | 'static-model' // 网格、无骨架
  | 'animations-only' // 无网格、有骨架+动画(纯动作文件)
  | 'unusable'

/** 按内容识别导入文件的类型,决定生成哪些库条目 */
export function classifyModel(
  root: Object3D,
  animations: AnimationClip[],
): ModelClass {
  const {meshCount} = meshStats(root)
  const boneCount = collectBoneNames(root).length
  if (meshCount > 0) return boneCount > 0 ? 'model' : 'static-model'
  if (boneCount > 0 && animations.length > 0) return 'animations-only'
  return 'unusable'
}

/**
 * 校验 .pose.json 文件内容:必须是 {rig, bones:{骨骼名:{rotation?,position?}}},
 * rotation 为四元数(4 个数),position 为三元组。合法返回内容,否则 null。
 */
export function validatePoseJson(
  json: unknown,
): {rig: string; bones: PoseEntry['bones']} | null {
  if (!json || typeof json !== 'object') return null
  const {rig, bones} = json as {rig?: unknown; bones?: unknown}
  if (!bones || typeof bones !== 'object') return null
  for (const [name, v] of Object.entries(bones as Record<string, unknown>)) {
    if (!name) return null
    const {rotation, position} = v as {rotation?: unknown; position?: unknown}
    if (
      rotation !== undefined &&
      (!Array.isArray(rotation) ||
        rotation.length !== 4 ||
        !rotation.every((n) => Number.isFinite(n)))
    ) {
      return null
    }
    if (
      position !== undefined &&
      (!Array.isArray(position) ||
        position.length !== 3 ||
        !position.every((n) => Number.isFinite(n)))
    ) {
      return null
    }
  }
  return {
    rig: typeof rig === 'string' ? rig : 'unknown',
    bones: bones as PoseEntry['bones'],
  }
}
