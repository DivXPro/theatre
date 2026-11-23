// packages/camera-studio/src/poseMode/poseFrame.test.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):播放头贴网格后恰等于某姿势帧 =
 * 编辑该帧(保存=覆盖);否则 = 新建帧(保存=插入)。
 */
import {
  determinePoseFrameMode,
  getScenePoseCoverage,
  getScenePoseCoverageSpans,
} from './poseFrame'

const snap = (t: number) => Math.round(t * 30) / 30 // 30fps 网格

test('播放头贴网格后落在帧上 = edit', () => {
  expect(determinePoseFrameMode([1, 2, 3], 2.001, snap)).toEqual({
    mode: 'edit',
    position: 2,
  })
})

test('两帧之间 = new', () => {
  expect(determinePoseFrameMode([1, 2, 3], 2.5, snap)).toEqual({
    mode: 'new',
    position: 2.5,
  })
})

test('无帧轨道 = new(保存即建轨写首帧)', () => {
  expect(determinePoseFrameMode([], 0, snap)).toEqual({
    mode: 'new',
    position: 0,
  })
})

test.each([
  [[], 2, 'none'],
  [[3, 1], 0, 'hold-before'],
  [[3, 1], 1, 'key'],
  [[3, 1], 2, 'between'],
  [[3, 1], 4, 'hold-after'],
  [[2], 1, 'hold-before'],
  [[2], 3, 'hold-after'],
] as const)('pose coverage for %j at %s is %s', (positions, at, coverage) => {
  expect(getScenePoseCoverage(positions, at)).toBe(coverage)
})

test('timeline marks the range between keys solid and endpoint holds dashed', () => {
  expect(getScenePoseCoverageSpans([6, 2], 10)).toEqual([
    {start: 0, end: 2, held: true},
    {start: 2, end: 6, held: false},
    {start: 6, end: 10, held: true},
  ])
})

test('one scene key holds across both sides without an interpolation span', () => {
  expect(getScenePoseCoverageSpans([2], 10)).toEqual([
    {start: 0, end: 2, held: true},
    {start: 2, end: 10, held: true},
  ])
  expect(getScenePoseCoverageSpans([], 10)).toEqual([])
})
