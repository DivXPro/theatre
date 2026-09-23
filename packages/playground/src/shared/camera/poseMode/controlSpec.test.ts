// packages/playground/src/shared/camera/poseMode/controlSpec.test.ts
import {Bone, Group} from 'three'
import {
  findRootBone,
  measureSkeletonScale,
  resolveControlSpec,
} from './controlSpec'

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

// —— measureSkeletonScale ——
function positionedSkeleton(positions: Record<string, number>): Group {
  const root = new Group()
  for (const [n, y] of Object.entries(positions)) {
    const b = new Bone()
    b.name = n
    b.position.y = y
    root.add(b)
  }
  return root
}

test('measureSkeletonScale: 3.4 单位高人形 → 倍率 ≈ 2', () => {
  // Mixamo 全骨平铺,Head 在 3.4、双脚在 0 → 高 3.4 → 3.4/1.7 = 2
  const pos: Record<string, number> = {}
  for (const n of MIXAMO_REQUIRED) pos[n] = 0
  pos['mixamorig:Head'] = 3.4
  expect(measureSkeletonScale(positionedSkeleton(pos))).toBeCloseTo(2, 5)
})

test('measureSkeletonScale: 1.7 单位人形 → 倍率 1', () => {
  const pos: Record<string, number> = {}
  for (const n of MIXAMO_REQUIRED) pos[n] = 0
  pos['mixamorig:Head'] = 1.7
  expect(measureSkeletonScale(positionedSkeleton(pos))).toBeCloseTo(1, 5)
})

test('measureSkeletonScale: 缺关键骨 → 1;全骨同高(测不出高度)→ 1;巨人不超上限 8', () => {
  const partial = MIXAMO_REQUIRED.filter((n) => n !== 'mixamorig:Head')
  expect(measureSkeletonScale(skeletonWith(partial))).toBe(1)
  expect(measureSkeletonScale(skeletonWith(MIXAMO_REQUIRED))).toBe(1)
  const pos: Record<string, number> = {}
  for (const n of MIXAMO_REQUIRED) pos[n] = 0
  pos['mixamorig:Head'] = 100
  expect(measureSkeletonScale(positionedSkeleton(pos))).toBe(8)
})
