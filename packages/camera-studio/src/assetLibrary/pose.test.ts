import {Bone, Group} from 'three'
import {applyPose, capturePose} from './pose'

function makeRig(): {root: Group; hips: Bone; spine: Bone} {
  const root = new Group()
  const hips = new Bone()
  hips.name = 'hips'
  const spine = new Bone()
  spine.name = 'spine'
  hips.add(spine)
  root.add(hips)
  return {root, hips, spine}
}

describe('capturePose / applyPose', () => {
  test('capture 记录每根骨骼的旋转与位置', () => {
    const {root, hips} = makeRig()
    hips.quaternion.set(0, 0, Math.SQRT1_2, Math.SQRT1_2)
    hips.position.set(1, 2, 3)
    const pose = capturePose(root)
    expect(Object.keys(pose).sort()).toEqual(['hips', 'spine'])
    expect(pose.hips.rotation![2]).toBeCloseTo(Math.SQRT1_2)
    expect(pose.hips.position).toEqual([1, 2, 3])
  })

  test('apply 把骨骼恢复到 capture 时的状态(往返)', () => {
    const {root, hips, spine} = makeRig()
    hips.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize()
    spine.position.set(0, 5, 0)
    const pose = capturePose(root)
    hips.quaternion.set(0, 0, 0, 1)
    spine.position.set(9, 9, 9)
    const r = applyPose(root, pose)
    expect(r.applied).toBe(2)
    expect(r.missed).toEqual([])
    expect(hips.quaternion.x).toBeCloseTo(0.1 / Math.sqrt(0.95), 5)
    expect(spine.position.y).toBe(5)
  })

  test('apply 跳过实例里不存在的骨骼名,计入 missed', () => {
    const {root} = makeRig()
    const r = applyPose(root, {
      ghost: {rotation: [0, 0, 0, 1]},
      hips: {position: [7, 0, 0]},
    })
    expect(r.applied).toBe(1)
    expect(r.missed).toEqual(['ghost'])
  })
})
