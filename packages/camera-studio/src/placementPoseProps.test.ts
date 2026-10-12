// packages/camera-studio/src/placementPoseProps.test.ts
/**
 * PlacementManager 姿势注册改造的可测纯件:
 * - countLibraryEntryUsage 的姿势计数对旧裸 id 与新 {kind:'lib'} 都算使用
 * - 注册形态:pose = hidden + 自定义插值器;poseOverride 保留但 hidden(迁移过渡)
 */
import {
  isPoseEntryUsed,
  posePropConfigShape,
  shouldApplyPoseDuringPlayback,
  shouldApplyPoseWhenIdle,
} from './placementPoseProps'
import {poseInterpolate} from './poseMode/poseInterpolate'

test('isPoseEntryUsed:旧裸 id 与新格式 lib 引用都算使用;custom 不算', () => {
  expect(isPoseEntryUsed('entry_a', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"lib","id":"entry_a"}', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"custom","bones":{}}', 'entry_a')).toBe(false)
  expect(isPoseEntryUsed('', 'entry_a')).toBe(false)
})

test('posePropConfigShape:editor=pose + poseInterpolate + 空默认(属性行化)', () => {
  const shape = posePropConfigShape()
  expect(shape.defaultValue).toBe('')
  expect(shape.opts.editor).toBe('pose')
  expect(shape.opts.interpolate).toBe(poseInterpolate)
  expect(typeof shape.opts.label).toBe('function')
})

test('播放中只在有姿势轨道时逐帧应用姿势(spec §7.1)', () => {
  expect(shouldApplyPoseDuringPlayback(true)).toBe(true)
  expect(shouldApplyPoseDuringPlayback(false)).toBe(false)
})

test('空闲应用门禁:播放中不应用;姿势会话中不抢骨骼(退出后由依赖重跑补刷)', () => {
  // 空闲且非姿势模式 = 应用(值切换/撤销重做/会话退出补刷都走这里)
  expect(shouldApplyPoseWhenIdle(false, false)).toBe(true)
  // 播放中 = 不应用(mixer/播放求值独占)
  expect(shouldApplyPoseWhenIdle(true, false)).toBe(false)
  // 姿势模式会话中 = 不应用(IK 骨架每帧重解算,applyPose 会被压回;
  // 会话期间值被弹框/撤销/同步改掉时靠退出后的重跑补刷,不在会话里抢)
  expect(shouldApplyPoseWhenIdle(false, true)).toBe(false)
  expect(shouldApplyPoseWhenIdle(true, true)).toBe(false)
})
