// packages/camera-studio/src/poseMode/poseFrame.test.ts
/**
 * 摆姿势进入的帧模式判定(spec §8.1):播放头贴网格后恰等于某姿势帧 =
 * 编辑该帧(保存=覆盖);否则 = 新建帧(保存=插入)。
 */
import {determinePoseFrameMode} from './poseFrame'

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
