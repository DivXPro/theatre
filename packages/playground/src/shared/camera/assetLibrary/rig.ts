import type {Bone, Mesh} from 'three'
import type {Object3D} from 'three'
import {hashString} from './hash'

/** 收集整棵树的骨骼名,排序后返回(排序保证同名集合同结果) */
export function collectBoneNames(root: Object3D): string[] {
  const names: string[] = []
  root.traverse((obj) => {
    if ((obj as Bone).isBone) names.push(obj.name)
  })
  return names.sort()
}

/**
 * 骨架族 id:骨骼名集合的哈希。同一套骨骼命名(如都是 Mixamo 导出)
 * 的模型自动同族,姿势/动作在同族内通用;无骨骼的模型记 'static'。
 */
export function rigIdOf(root: Object3D): string {
  const names = collectBoneNames(root)
  if (names.length === 0) return 'static'
  return 'rig-' + hashString(names.join(''))
}

/** 网格数量与顶点总数:导入分类和"高度相似"去重比对用 */
export function meshStats(root: Object3D): {
  meshCount: number
  vertexCount: number
} {
  let meshCount = 0
  let vertexCount = 0
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (mesh.isMesh) {
      meshCount++
      vertexCount += mesh.geometry?.attributes?.position?.count ?? 0
    }
  })
  return {meshCount, vertexCount}
}
