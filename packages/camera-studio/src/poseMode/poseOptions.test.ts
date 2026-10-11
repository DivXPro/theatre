/**
 * 姿势选择弹框的选项组装(属性面板姿势行):纯函数便于单测。
 * 规则(2026-10-01 与用户对齐):
 * - 「T 姿势」(绑定/默认)永远第一项——弹框就是纯姿势列表;
 * - 自定义姿势不是弹框选项(只能双击模型进姿势模式编辑产生),
 *   但 current 仍会如实报 'custom'(列表里无对应高亮项);
 * - 库预设按骨架族过滤,不匹配的置灰带提示;
 * - 当前值是已被删除的库条目时,追加一个置灰缺失项如实显示现状。
 */
import {buildPoseOptions} from './poseOptions'
import {serializeCustomPose, serializeLibPose} from './poseValue'

const t = (k: string) => `#${k}#`
const libEntries = [
  {id: 'lib-wave', name: '挥手', rig: 'mixamo'},
  {id: 'lib-sit', name: '坐下', rig: 'mixamo'},
  {id: 'lib-vrm1', name: 'VRM 万岁', rig: 'vrm'},
] as any[]

test('空值(绑定):T 姿势第一项,当前 bind;无任何 custom 选项', () => {
  const {options, current} = buildPoseOptions({poseJson: '', libEntries, t})
  expect(current).toBe('bind')
  expect(options.map((o) => o.key)).toEqual([
    'bind',
    'lib:lib-wave',
    'lib:lib-sit',
    'lib:lib-vrm1',
  ])
  expect(options[0]!.label).toBe('#pg.pose.tPose#')
})

test('当前是库姿势:current 指向该条目', () => {
  const {current} = buildPoseOptions({
    poseJson: serializeLibPose('lib-wave'),
    libEntries,
    t,
  })
  expect(current).toBe('lib:lib-wave')
})

test('当前是自定义:current 报 custom,但选项里没有 custom 项', () => {
  const {options, current} = buildPoseOptions({
    poseJson: serializeCustomPose({Hips: {rotation: [0, 0, 0, 1]}} as any),
    libEntries,
    t,
  })
  expect(current).toBe('custom')
  expect(options.map((o) => o.key) as string[]).not.toContain('custom')
})

test('骨架不匹配:置灰并带提示;无骨架信息不过滤', () => {
  const {options} = buildPoseOptions({
    poseJson: '',
    libEntries,
    selectedRig: 'mixamo' as any,
    t,
  })
  const vrm = options.find((o) => o.key === 'lib:lib-vrm1')!
  const wave = options.find((o) => o.key === 'lib:lib-wave')!
  expect(vrm.disabled).toBe(true)
  expect(vrm.hint).toBeTruthy()
  expect(wave.disabled).toBeFalsy()
})

test('当前库条目已被删除:追加置灰缺失项作为当前显示', () => {
  const {options, current} = buildPoseOptions({
    poseJson: serializeLibPose('lib-gone'),
    libEntries,
    t,
  })
  expect(current).toBe('lib:lib-gone')
  const missing = options.find((o) => o.key === 'lib:lib-gone')!
  expect(missing.disabled).toBe(true)
  expect(missing.hint).toBeTruthy()
})

test('「T 姿势」项挂 bindThumbUrl(模型自己的图);不传则无图', () => {
  const withThumb = buildPoseOptions({
    poseJson: '',
    libEntries,
    bindThumbUrl: 'blob:model-thumb',
    t,
  })
  expect(withThumb.options[0]).toMatchObject({
    key: 'bind',
    thumbUrl: 'blob:model-thumb',
  })
  const without = buildPoseOptions({poseJson: '', libEntries, t})
  expect(without.options[0]!.thumbUrl).toBeUndefined()
})
