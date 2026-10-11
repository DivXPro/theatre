// packages/playground/src/shared/camera/poseMode/poseRetarget.test.ts
import {Quaternion, Vector3} from 'three'
import {retargetPose} from './poseRetarget'
import type {RestBone} from './poseRetarget'

const Q0: [number, number, number, number] = [0, 0, 0, 1]

/** 构造 rest 快照:全单位 local,父链决定世界 */
function bone(
  name: string,
  parent: string | null,
  localQuat: [number, number, number, number] = Q0,
  worldQuat: [number, number, number, number] = Q0,
): RestBone {
  return {name, parent, localQuat, worldQuat}
}

function worldYOf(q: [number, number, number, number]): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...q)).normalize()
}

describe('retargetPose', () => {
  it('方向全给 rest 骨向时输出恒等(全骨 local=rest local)', () => {
    const rest = [bone('hips', null), bone('head', 'hips')]
    const dirs = {
      hips: [0, 1, 0] as [number, number, number],
      head: [0, 1, 0] as [number, number, number],
    }
    const out = retargetPose(rest, dirs)
    // 全单位 rest + 方向即 rest 骨向 → 每骨 local 仍为单位(w≈1,xyz≈0)
    for (const name of ['hips', 'head']) {
      expect(out[name].rotation![3]).toBeCloseTo(1, 5)
      expect(out[name].rotation![0]).toBeCloseTo(0, 5)
    }
  })

  it('单链根骨转 90°:根 local=弧,子 local 保 rest,子世界随父', () => {
    const rest = [bone('hips', null), bone('arm', 'hips')]
    // rest 世界 Y = (0,1,0),目标 (1,0,0):绕 Z 轴 -90°
    const out = retargetPose(rest, {hips: [1, 0, 0]})
    const rootQ = new Quaternion(...out.hips.rotation!)
    // 根的世界 Y 应指向 (1,0,0)
    const rootWorldY = worldYOf(out.hips.rotation!)
    expect(rootWorldY.x).toBeCloseTo(1, 5)
    expect(rootWorldY.y).toBeCloseTo(0, 5)
    // 子 local 保 rest(单位)
    expect(out.arm.rotation![3]).toBeCloseTo(1, 5)
    // 子世界 = 根世界 × 子 local = 根世界
    const childWorld = rootQ
      .clone()
      .multiply(new Quaternion(...out.arm.rotation!))
    const childWorldY = new Vector3(0, 1, 0).applyQuaternion(childWorld)
    expect(childWorldY.x).toBeCloseTo(1, 5)
  })

  it('带旋转的 rest:换算后世界骨向精确命中目标方向', () => {
    // rest 根骨绕 Z 转 45°,世界 Y = (sin45, cos45, 0)
    const restRootQ = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      -Math.PI / 4,
    )
    const rest: RestBone[] = [
      {
        name: 'hips',
        parent: null,
        localQuat: [restRootQ.x, restRootQ.y, restRootQ.z, restRootQ.w],
        worldQuat: [restRootQ.x, restRootQ.y, restRootQ.z, restRootQ.w],
      },
    ]
    const out = retargetPose(rest, {hips: [0, 0, 1]})
    const gotY = worldYOf(out.hips.rotation!)
    expect(gotY.x).toBeCloseTo(0, 5)
    expect(gotY.y).toBeCloseTo(0, 5)
    expect(gotY.z).toBeCloseTo(1, 5)
  })

  it('dirs 里的未知骨名被忽略,输出仍覆盖 rest 全骨', () => {
    const rest = [bone('hips', null)]
    const out = retargetPose(rest, {nope: [1, 0, 0]})
    expect(Object.keys(out)).toEqual(['hips'])
    expect(out.hips.rotation![3]).toBeCloseTo(1, 5)
  })

  it('三级链中间骨动:末端随动但 local 不变', () => {
    const rest = [
      bone('hips', null),
      bone('thigh', 'hips'),
      bone('shin', 'thigh'),
    ]
    const out = retargetPose(rest, {thigh: [0, -0.7, 0.7]})
    // thigh 世界 Y 命中
    const thighWorld = new Quaternion(...out.thigh.rotation!)
    const thighY = new Vector3(0, 1, 0).applyQuaternion(thighWorld).normalize()
    expect(thighY.y).toBeCloseTo(-0.7071, 3)
    expect(thighY.z).toBeCloseTo(0.7071, 3)
    // shin local 保 rest
    expect(out.shin.rotation![3]).toBeCloseTo(1, 5)
    // shin 世界 = thigh 世界 × shin local → 世界 Y 同 thigh
    const shinWorld = thighWorld
      .clone()
      .multiply(new Quaternion(...out.shin.rotation!))
    const shinY = new Vector3(0, 1, 0).applyQuaternion(shinWorld).normalize()
    expect(shinY.y).toBeCloseTo(-0.7071, 3)
  })
})
