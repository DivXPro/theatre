// packages/playground/src/shared/camera/poseMode/controlSpec.test.ts
import {Bone, Group} from 'three'
import {findRootBone, resolveControlSpec} from './controlSpec'

/** 按 Mixamo 命名习惯拼一棵骨架(平面树即可:映射只看骨名) */
function skeletonWith(names: string[]): Group {
  const root = new Group()
  for (const n of names) {
    const b = new Bone()
    b.name = n
    root.add(b)
  }
  return root
}

const MIXAMO_REQUIRED = [
  'mixamorig:Hips',
  'mixamorig:Spine',
  'mixamorig:Spine1',
  'mixamorig:Spine2',
  'mixamorig:Neck',
  'mixamorig:Head',
  'mixamorig:LeftShoulder',
  'mixamorig:LeftArm',
  'mixamorig:LeftForeArm',
  'mixamorig:LeftHand',
  'mixamorig:RightShoulder',
  'mixamorig:RightArm',
  'mixamorig:RightForeArm',
  'mixamorig:RightHand',
  'mixamorig:LeftUpLeg',
  'mixamorig:LeftLeg',
  'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg',
  'mixamorig:RightLeg',
  'mixamorig:RightFoot',
]

test('Mixamo 全骨 → 完整控制点表,骨名用模型侧名字', () => {
  const spec = resolveControlSpec(skeletonWith(MIXAMO_REQUIRED))
  expect(spec).not.toBeNull()
  const byName = new Map(spec!.map((c) => [c.name, c]))
  expect([...byName.keys()].sort()).toEqual(
    ['armL', 'armR', 'chest', 'head', 'hips', 'legL', 'legR', 'spine'].sort(),
  )
  expect((byName.get('hips') as any).bone).toBe('mixamorig:Hips')
  expect((byName.get('armL') as any).rootBone).toBe('mixamorig:LeftArm')
  expect((byName.get('armL') as any).endBone).toBe('mixamorig:LeftHand')
  expect((byName.get('spine') as any).endBone).toBe('mixamorig:Neck')
  expect((byName.get('head') as any).rootBone).toBe('mixamorig:Neck')
})

test('缺关键骨(LeftHand)→ null', () => {
  const names = MIXAMO_REQUIRED.filter((n) => n !== 'mixamorig:LeftHand')
  expect(resolveControlSpec(skeletonWith(names))).toBeNull()
})

test('无前缀 Mixamo 命名(ReadyPlayerMe 风格)→ 可解析', () => {
  const names = MIXAMO_REQUIRED.map((n) => n.replace('mixamorig:', ''))
  const spec = resolveControlSpec(skeletonWith(names))
  expect(spec).not.toBeNull()
  expect((spec!.find((c) => c.name === 'hips') as any).bone).toBe('Hips')
})

test('VRM camelCase 命名 → 可解析', () => {
  const names = [
    'hips',
    'spine',
    'chest',
    'upperChest',
    'neck',
    'head',
    'leftShoulder',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightShoulder',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
  ]
  const spec = resolveControlSpec(skeletonWith(names))
  expect(spec).not.toBeNull()
  expect((spec!.find((c) => c.name === 'hips') as any).bone).toBe('hips')
})

test('无骨骼 → null;findRootBone 找父不是 Bone 的第一根', () => {
  expect(resolveControlSpec(new Group())).toBeNull()
  expect(findRootBone(new Group())).toBeNull()
  const root = new Group()
  const hips = new Bone()
  hips.name = 'Hips'
  const spine = new Bone()
  spine.name = 'Spine'
  hips.add(spine)
  root.add(hips)
  expect(findRootBone(root)?.name).toBe('Hips')
})
