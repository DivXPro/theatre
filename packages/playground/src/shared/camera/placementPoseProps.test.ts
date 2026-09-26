// packages/playground/src/shared/camera/placementPoseProps.test.ts
/**
 * PlacementManager 姿势注册改造的可测纯件:
 * - countLibraryEntryUsage 的姿势计数对旧裸 id 与新 {kind:'lib'} 都算使用
 * - 注册形态:pose = hidden + 自定义插值器;poseOverride 保留但 hidden(迁移过渡)
 */
import {isPoseEntryUsed, posePropConfigShape} from './placementPoseProps'
import {poseInterpolate} from './poseMode/poseInterpolate'

test('isPoseEntryUsed:旧裸 id 与新格式 lib 引用都算使用;custom 不算', () => {
  expect(isPoseEntryUsed('entry_a', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"lib","id":"entry_a"}', 'entry_a')).toBe(true)
  expect(isPoseEntryUsed('{"kind":"custom","bones":{}}', 'entry_a')).toBe(false)
  expect(isPoseEntryUsed('', 'entry_a')).toBe(false)
})

test('posePropConfigShape:hidden + poseInterpolate + 空默认', () => {
  const shape = posePropConfigShape()
  expect(shape.defaultValue).toBe('')
  expect(shape.opts.hidden).toBe(true)
  expect(shape.opts.interpolate).toBe(poseInterpolate)
  expect(typeof shape.opts.label).toBe('function')
})
