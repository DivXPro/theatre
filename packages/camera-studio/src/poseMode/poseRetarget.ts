// packages/camera-studio/src/poseMode/poseRetarget.ts
/**
 * 姿势重定向(2026-10-02 内置姿势管线,机制经 spike 验证):
 * 把「每根骨的世界 Y 轴目标方向」换算成目标骨架的 local 四元数快照。
 *
 * 为什么不直接搬 local:不同骨架/不同工具链(Blender↔FBX↔three)对同一
 * 骨骼的 local 表示不同(骨轴约定),直接搬必拧;世界骨向是表示无关的
 * 共同语言。换算规则(最短弧):
 *   newWorldQ = setFromUnitVectors(restWorldY → targetDir) × restWorldQ
 * 即「从 rest 骨向最短弧转到目标方向,roll 保 rest 关系」。代价是丢源骨
 * 的 roll 变化(手臂内旋等),姿势库场景可接受——换来对任意 roll 差异
 * (实测大腿/脚两骨架差 ~180°)不拧麻花。
 *
 * 层级:输入 restBones 必须根到叶序。dirs 没给方向的骨随父(local 保
 * rest,世界随父链新姿势)。输出覆盖 restBones 全部骨——库姿势应用时
 * 全身确定,切换姿势无残留(见 pose.ts applyPose 只写列出的骨)。
 *
 * 纯函数无 DOM 依赖:jest 与 node 构建脚本(scripts/pose-pipeline)共用。
 */
import {Quaternion, Vector3} from 'three'
import type {PoseBones} from './poseOverride'

export type RestBone = {
  name: string
  /** 父骨名;根骨为 null(其父链为非骨节点,世界基准由 worldQuat 反推) */
  parent: string | null
  /** rest local 四元数 [x,y,z,w] */
  localQuat: [number, number, number, number]
  /** rest 世界四元数(含全部父链,含非骨祖先) [x,y,z,w] */
  worldQuat: [number, number, number, number]
}

/**
 * @param restBones - 目标骨架 rest 快照,根到叶序
 * @param dirs - 骨名 → 目标世界 Y 轴方向(three.js 系,无需归一化)
 * @returns PoseBones(覆盖 restBones 全部骨;dirs 里的多余骨名忽略)
 */
export function retargetPose(
  restBones: RestBone[],
  dirs: Record<string, [number, number, number]>,
): PoseBones {
  const newWorldQ = new Map<string, Quaternion>()
  const out: PoseBones = {}
  for (const b of restBones) {
    const restWorld = new Quaternion(...b.worldQuat)
    // 根骨的父世界:rest 时 worldQ × localQ⁻¹,换算全程不变(非骨祖先不动)
    const parentWorld = b.parent
      ? newWorldQ.get(b.parent)!
      : restWorld.clone().multiply(new Quaternion(...b.localQuat).invert())
    let worldQ: Quaternion
    const dir = dirs[b.name]
    if (dir) {
      const restY = new Vector3(0, 1, 0).applyQuaternion(restWorld).normalize()
      const target = new Vector3(...dir).normalize()
      worldQ = new Quaternion()
        .setFromUnitVectors(restY, target)
        .multiply(restWorld)
    } else {
      // 随父:世界 = 新父世界 × rest local
      worldQ = parentWorld.clone().multiply(new Quaternion(...b.localQuat))
    }
    newWorldQ.set(b.name, worldQ)
    const local = parentWorld.clone().invert().multiply(worldQ)
    out[b.name] = {rotation: [local.x, local.y, local.z, local.w]}
  }
  return out
}
