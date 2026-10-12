// packages/camera-studio/src/poseMode/poseInterpolate.test.ts
/**
 * 姿势插值器(spec §4):两侧都能解析出骨骼 → 逐骨骼 slerp/lerp,结果恒为
 * custom 快照(两帧之间的求值产物);任一侧不行 → 阶跃返回 left。
 * parse 结果按字符串值 LRU 缓存,求值热路径不重复 parse。
 */
import {Quaternion, Vector3} from 'three'
import {mixPoseBones, poseInterpolate} from './poseInterpolate'
import {__primeLibPoseCache, __resetLibPoseCache} from './poseLibResolve'
import {serializeCustomPose, serializeLibPose} from './poseValue'
import type {PoseBones} from './poseOverride'

const A: PoseBones = {
  Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]},
}
const B: PoseBones = {
  // 绕 Z 转 90°:四元数 (0,0,sin45°,cos45°)
  Hips: {rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], position: [0, 2, 2]},
}

beforeEach(() => {
  __resetLibPoseCache()
  // 阶跃用例会触发 warn-once(库未解析/非法 JSON),统一压掉控制台噪音
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

test('mixPoseBones:中点 = 旋转 slerp 一半 + 位置 lerp 一半', () => {
  const mid = mixPoseBones(A, B, 0.5)
  const q = new Quaternion().fromArray(mid.Hips.rotation!)
  const expected = new Quaternion().slerp(
    new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    0.5,
  )
  expect(q.angleTo(expected)).toBeLessThan(1e-6)
  expect(new Vector3().fromArray(mid.Hips.position!).toArray()).toEqual([
    0, 1.5, 1,
  ])
})

test('mixPoseBones:端点恒等(t=0 回 a,t=1 回 b)', () => {
  expect(mixPoseBones(A, B, 0)).toEqual(A)
  expect(mixPoseBones(A, B, 1)).toEqual(B)
})

test('mixPoseBones:只在一侧有的骨骼全程取有数据侧', () => {
  const onlyA: PoseBones = {ArmL: {rotation: [0, 0, 0, 1], position: [1, 0, 0]}}
  const merged = {...A, ...onlyA}
  for (const t of [0, 0.3, 1]) {
    expect(mixPoseBones(merged, B, t).ArmL).toEqual(onlyA.ArmL)
    expect(mixPoseBones(A, {...B, ...onlyA}, t).ArmL).toEqual(onlyA.ArmL)
  }
})

test('poseInterpolate:custom↔custom 结果是可回读的 custom 快照', () => {
  const out = poseInterpolate(
    serializeCustomPose(A),
    serializeCustomPose(B),
    0.5,
  )
  expect(JSON.parse(out).kind).toBe('custom')
  expect(out).toBe(serializeCustomPose(mixPoseBones(A, B, 0.5)))
})

test('poseInterpolate:lib 引用经缓存解析后参与混合(lib↔custom、lib↔lib)', () => {
  __primeLibPoseCache('pa', A)
  __primeLibPoseCache('pb', B)
  expect(
    poseInterpolate(serializeLibPose('pa'), serializeCustomPose(B), 1),
  ).toBe(serializeCustomPose(B))
  expect(
    poseInterpolate(serializeLibPose('pa'), serializeLibPose('pb'), 0),
  ).toBe(serializeCustomPose(A))
})

test('poseInterpolate:一侧空/非法/库未解析 → 阶跃返回 left 原串', () => {
  const left = serializeCustomPose(A)
  expect(poseInterpolate(left, '', 0.5)).toBe(left)
  expect(poseInterpolate(left, '{oops', 0.5)).toBe(left)
  expect(poseInterpolate(left, serializeLibPose('notFetched'), 0.5)).toBe(left)
  expect(poseInterpolate('', serializeCustomPose(B), 0.5)).toBe('')
})
