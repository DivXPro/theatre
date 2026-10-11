// packages/playground/src/shared/camera/boneAnchors.test.ts
import {Bone, Object3D} from 'three'
import {
  BONE_PARTS,
  parseBoneAnchorId,
  resolveAnchorBones,
  makeBoneAnchorId,
  registerBoneAnchors,
  unregisterBoneAnchors,
  getBoneAnchorObjects,
} from './boneAnchors'

function mixamoRig(): Object3D {
  // Y Bot 实测骨架的精简版:mixamorig 前缀、无冒号
  const names = [
    'mixamorigHips',
    'mixamorigSpine',
    'mixamorigSpine1',
    'mixamorigSpine2',
    'mixamorigNeck',
    'mixamorigHead',
    'mixamorigLeftHand',
    'mixamorigRightHand',
    'mixamorigLeftLeg',
    'mixamorigRightLeg',
  ]
  const root = new Object3D()
  const byName = new Map<string, Bone>()
  for (const name of names) {
    const bone = new Bone()
    bone.name = name
    byName.set(name, bone)
  }
  // brief 原稿只 root.add(hips)、其余骨骼游离在树外,traverse 不可达;
  // 按"精简版实测骨架"的意图把全部骨骼挂进树(其余断言逐字不变)
  for (const bone of byName.values()) root.add(bone)
  return root
}

describe('resolveAnchorBones', () => {
  test('mixamo 骨架六个部位全命中', () => {
    const found = resolveAnchorBones(mixamoRig())
    expect(Object.keys(found).sort()).toEqual([...BONE_PARTS].sort())
    expect(found.head?.name).toBe('mixamorigHead')
    expect(found.chest?.name).toBe('mixamorigSpine1')
    expect(found.handL?.name).toBe('mixamorigLeftHand')
    expect(found.handR?.name).toBe('mixamorigRightHand')
    expect(found.legL?.name).toBe('mixamorigLeftLeg')
    expect(found.legR?.name).toBe('mixamorigRightLeg')
  })
  test('容忍冒号/大小写变体(mixamorig:Head / MixamorigHead)', () => {
    const root = new Object3D()
    for (const name of [
      'mixamorig:Head',
      'MixamorigSpine1',
      'LEFTHAND',
      'right_hand',
    ]) {
      const b = new Bone()
      b.name = name
      root.add(b)
    }
    const found = resolveAnchorBones(root)
    expect(found.head).toBeDefined()
    expect(found.chest).toBeDefined()
    expect(found.handL).toBeDefined()
    expect(found.handR).toBeDefined()
  })
  test('无骨骼的静态模型全部落空', () => {
    const root = new Object3D()
    root.add(new Object3D())
    expect(resolveAnchorBones(root)).toEqual({})
  })
})

describe('bone anchor id', () => {
  test('构造/解析互逆;坏 id 返回 null', () => {
    const id = makeBoneAnchorId('Models / Y Bot', 'head')
    expect(id).toBe('bone:Models / Y Bot#head')
    expect(parseBoneAnchorId(id)).toEqual({
      placementKey: 'Models / Y Bot',
      part: 'head',
    })
    expect(parseBoneAnchorId('anchor:Anchor 1')).toBeNull()
    expect(parseBoneAnchorId('bone:no-part-here')).toBeNull()
    expect(parseBoneAnchorId('bone:k#nope')).toBeNull()
  })
})

describe('registerBoneAnchors / unregisterBoneAnchors', () => {
  test('登记后在 getBoneAnchorObjects 可查,按 placementKey 成组清理', () => {
    const rig = mixamoRig()
    registerBoneAnchors('Models / Y Bot', rig)
    const all = getBoneAnchorObjects()
    expect(all.size).toBe(6)
    const headId = makeBoneAnchorId('Models / Y Bot', 'head')
    // 锚点是挂到骨骼下的子节点
    expect(all.get(headId)?.parent?.name).toBe('mixamorigHead')
    unregisterBoneAnchors('Models / Y Bot')
    expect(getBoneAnchorObjects().size).toBe(0)
  })
  test('同一模型重复登记不堆积(先清同组再挂)', () => {
    const rig = mixamoRig()
    registerBoneAnchors('M1', rig)
    registerBoneAnchors('M1', rig)
    expect(getBoneAnchorObjects().size).toBe(6)
    unregisterBoneAnchors('M1')
  })
})
