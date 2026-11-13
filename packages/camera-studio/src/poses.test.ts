import {Bone, Object3D} from 'three'
import {
  applyPose,
  BUILTIN_POSE_RIG,
  getBuiltinPose,
  listBuiltinPoses,
} from './poses'

describe('内置静态姿势公开 API', () => {
  test('条目 id 稳定、唯一,并且都属于内置骨架族', () => {
    const poses = listBuiltinPoses()
    expect(poses.length).toBeGreaterThan(100)
    expect(new Set(poses.map((p) => p.id)).size).toBe(poses.length)
    for (const pose of poses) {
      expect(pose.kind).toBe('pose')
      expect(pose.id.startsWith('seed-pose-')).toBe(true)
      expect(pose.name.length).toBeGreaterThan(0)
      expect(pose.rig).toBe(BUILTIN_POSE_RIG)
    }
  })

  test('按稳定 id 取姿势;未知 id 返回 undefined', () => {
    const pose = getBuiltinPose('seed-pose-stand-relaxed')
    expect(pose?.name).toBe('站立放松')
    expect(pose?.bones.mixamorigHips.rotation).toHaveLength(4)
    expect(getBuiltinPose('seed-pose-does-not-exist')).toBeUndefined()
  })

  test('手势条目只含手指骨,不会覆盖身体', () => {
    const gesture = getBuiltinPose('seed-pose-qbx-hands-02-other-fist-l')
    expect(gesture).toBeDefined()
    const finger =
      /^mixamorig(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/
    expect(Object.keys(gesture!.bones).every((name) => finger.test(name))).toBe(
      true,
    )
  })

  test('applyPose 按骨骼名写入,缺失骨计入 missed', () => {
    const root = new Object3D()
    const hips = new Bone()
    hips.name = 'mixamorigHips'
    root.add(hips)

    const pose = getBuiltinPose('seed-pose-stand-relaxed')!
    const result = applyPose(root, pose.bones)

    expect(result.applied).toBe(1)
    expect(result.missed).toHaveLength(Object.keys(pose.bones).length - 1)
    expect(hips.quaternion.toArray()).toEqual(pose.bones.mixamorigHips.rotation)
  })
})
