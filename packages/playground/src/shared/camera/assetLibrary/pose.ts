import type {Object3D} from 'three'
import type {PoseEntry} from './types'

/** 抓取骨骼树当前状态为姿势数据:按骨骼名记录四元数与位置 */
export function capturePose(root: Object3D): PoseEntry['bones'] {
  const bones: PoseEntry['bones'] = {}
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) {
      bones[o.name] = {
        rotation: o.quaternion.toArray() as [number, number, number, number],
        position: o.position.toArray() as [number, number, number],
      }
    }
  })
  return bones
}

/** 语义别名:实例刚克隆出来时的 capture 即绑定姿势,用于"无姿势"时还原 */
export const captureBindPose = capturePose

/**
 * 把姿势数据按骨骼名写回骨骼树。实例里没有的骨骼名跳过并计入
 * missed(跨族套用由调用方先过滤,这里只兜底)。
 */
export function applyPose(
  root: Object3D,
  bones: PoseEntry['bones'],
): {applied: number; missed: string[]} {
  const byName = new Map<string, Object3D>()
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) byName.set(o.name, o)
  })
  let applied = 0
  const missed: string[] = []
  for (const [name, v] of Object.entries(bones)) {
    const bone = byName.get(name)
    if (!bone) {
      missed.push(name)
      continue
    }
    if (v.rotation) bone.quaternion.fromArray(v.rotation)
    if (v.position) bone.position.fromArray(v.position)
    applied++
  }
  return {applied, missed}
}
