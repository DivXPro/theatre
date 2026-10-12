// packages/camera-studio/src/boneAnchors.ts
/**
 * 骨骼锚点:放置模型的"可瞄准部位"。按骨骼名在实例骨架里找
 * 头/胸口/双手/双腿,把无网格的 Object3D 挂到骨骼下(对齐 Blender
 * 空物体的"骨骼父子"),登记进模块级 Map 供瞄准/父级绑定解析。
 * 运行时零件,不进大纲、无属性面板。
 */
import type {Object3D} from 'three'
import {Object3D as Object3DImpl} from 'three'

export const BONE_PARTS = [
  'head',
  'chest',
  'handL',
  'handR',
  'legL',
  'legR',
] as const
export type BonePart = (typeof BONE_PARTS)[number]

/** 部位的骨骼名候选(按优先序);匹配前先做归一化 */
const BONE_CANDIDATES: Record<BonePart, string[]> = {
  head: ['Head'],
  // 胸口取中段脊柱(Spine1);Spine2 更靠脖颈,作兜底
  chest: ['Spine1', 'Spine2'],
  handL: ['LeftHand', 'HandLeft'],
  handR: ['RightHand', 'HandRight'],
  legL: ['LeftLeg', 'LegLeft', 'LeftShin'],
  legR: ['RightLeg', 'LegRight', 'RightShin'],
}

/** 归一化骨骼名:去 mixamorig 前缀/冒号、去下划线、转小写。
 *  "mixamorig:Head" / "Mixamorig_Head" / "Head" → "head" */
export function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:?/i, '')
    .replace(/_/g, '')
    .toLowerCase()
}

/** 在骨架树里按部位找骨骼;找不到的部位缺省(Y Bot 实测
 * 骨架前缀是 mixamorig、无冒号,归一化后天然兼容) */
export function resolveAnchorBones(
  root: Object3D,
): Partial<Record<BonePart, Object3D>> {
  const bones: Object3D[] = []
  root.traverse((o) => {
    if ((o as {isBone?: boolean}).isBone) bones.push(o)
  })
  const byNormalized = new Map<string, Object3D>()
  for (const bone of bones) {
    const key = normalizeBoneName(bone.name)
    if (!byNormalized.has(key)) byNormalized.set(key, bone)
  }
  const found: Partial<Record<BonePart, Object3D>> = {}
  for (const part of BONE_PARTS) {
    for (const candidate of BONE_CANDIDATES[part]) {
      const bone = byNormalized.get(normalizeBoneName(candidate))
      if (bone) {
        found[part] = bone
        break
      }
    }
  }
  return found
}

export function makeBoneAnchorId(placementKey: string, part: BonePart): string {
  return `bone:${placementKey}#${part}`
}

export function parseBoneAnchorId(
  id: string,
): {placementKey: string; part: BonePart} | null {
  if (!id.startsWith('bone:')) return null
  const hash = id.indexOf('#')
  if (hash < 0) return null
  const placementKey = id.slice(5, hash)
  const part = id.slice(hash + 1) as BonePart
  if (!placementKey || !(BONE_PARTS as readonly string[]).includes(part))
    return null
  return {placementKey, part}
}

/** anchorId(bone:…#part)→ 骨骼下的锚点节点 */
const boneAnchors = new Map<string, Object3D>()

/** 已登记的 placementKey → 当时的骨架根:同根重复登记直接短路——
 * 放置注册表增删任一模型都会让所有 PlacedModelCore 的登记 effect
 * 重跑,不守卫会把骨骼上的锚点节点摘掉重建,而已绑定到骨骼锚点上的
 * 锚点网格(其子节点)随之脱离场景树,再没有任何路径把它挂回来 */
const registeredRoots = new Map<string, Object3D>()

/**
 * 在放置实例上登记骨骼锚点:解析部位 → 挂节点 → 入表。
 * 同 placementKey 重复调用先清旧组(热更新/重挂载防堆积);
 * 同根重复调用(注册表增删导致的 effect 重跑)保持节点身份不重建。
 * 无骨骼的模型自然解析为空,不进表。
 */
export function registerBoneAnchors(
  placementKey: string,
  root: Object3D,
): void {
  if (registeredRoots.get(placementKey) === root) return
  unregisterBoneAnchors(placementKey)
  const found = resolveAnchorBones(root)
  for (const part of BONE_PARTS) {
    const bone = found[part]
    if (!bone) continue
    const anchor = new Object3DImpl()
    anchor.name = `Anchor_${part}`
    bone.add(anchor)
    boneAnchors.set(makeBoneAnchorId(placementKey, part), anchor)
  }
  registeredRoots.set(placementKey, root)
}

export function unregisterBoneAnchors(placementKey: string): void {
  for (const part of BONE_PARTS) {
    const id = makeBoneAnchorId(placementKey, part)
    const anchor = boneAnchors.get(id)
    if (anchor) {
      anchor.parent?.remove(anchor)
      boneAnchors.delete(id)
    }
  }
  registeredRoots.delete(placementKey)
}

export function getBoneAnchorObjects(): ReadonlyMap<string, Object3D> {
  return boneAnchors
}
