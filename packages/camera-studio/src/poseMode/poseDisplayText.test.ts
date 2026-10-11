/**
 * 姿势属性行的值区域显示文本(2026-10-01 与用户对齐):
 * - 空值(绑定)= 默认人体姿势 → 「T 姿势」;
 * - 库预设 → 预设名称(条目被删 → id + 缺失标记);
 * - 自定义(直接摆的,或选预设后又编辑过)→ 「自定义姿势」。
 */
import {poseDisplayText} from './poseDisplayText'
import {serializeCustomPose, serializeLibPose} from './poseValue'

const t = (k: string) => `#${k}#`
const libEntries = [
  {id: 'lib-wave', name: '挥手', rig: 'mixamo'},
  {id: 'lib-sit', name: '坐下', rig: 'mixamo'},
] as any[]

test('空值 → T 姿势', () => {
  expect(poseDisplayText({poseJson: '', libEntries, t})).toBe('#pg.pose.tPose#')
})

test('库预设命中 → 显示预设名称', () => {
  expect(
    poseDisplayText({poseJson: serializeLibPose('lib-wave'), libEntries, t}),
  ).toBe('挥手')
})

test('库预设缺失 → id + 缺失标记', () => {
  const text = poseDisplayText({
    poseJson: serializeLibPose('lib-gone'),
    libEntries,
    t,
  })
  expect(text).toContain('lib-gone')
  expect(text).toContain('#pg.pose.libMissing#')
})

test('自定义 → 自定义姿势', () => {
  expect(
    poseDisplayText({
      poseJson: serializeCustomPose({Hips: {rotation: [0, 0, 0, 1]}} as any),
      libEntries,
      t,
    }),
  ).toBe('#pg.pose.statusCustom#')
})
