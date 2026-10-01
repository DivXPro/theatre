/**
 * 姿势选择器选项组装(属性面板姿势区):纯函数便于单测。
 * 规则(2026-10-01 与用户对齐):
 * - 「绑定姿势」永远第一项;
 * - 「自定义姿势」在备份有效、或当前值就是自定义时出现(自定义保留可切回);
 * - 库预设按骨架族过滤,不匹配的置灰带提示;
 * - 当前值是已被删除的库条目时,追加一个置灰缺失项,让选择器如实显示现状。
 */
import {buildPoseOptions} from './poseOptions'
import {serializeCustomPose, serializeLibPose} from './poseValue'

const t = (k: string) => `#${k}#`
const libEntries = [
  {id: 'lib-wave', name: '挥手', rig: 'mixamo'},
  {id: 'lib-sit', name: '坐下', rig: 'mixamo'},
  {id: 'lib-vrm1', name: 'VRM 万岁', rig: 'vrm'},
] as any[]

test('无姿势无备份:只有绑定,当前绑定', () => {
  const {options, current} = buildPoseOptions({
    poseJson: '',
    backupJson: '',
    libEntries,
    t,
  })
  expect(current).toBe('bind')
  expect(options.map((o) => o.key)).toEqual([
    'bind',
    'lib:lib-wave',
    'lib:lib-sit',
    'lib:lib-vrm1',
  ])
})

test('备份是自定义快照:自定义选项出现;当前是库姿势', () => {
  const {options, current} = buildPoseOptions({
    poseJson: serializeLibPose('lib-wave'),
    backupJson: serializeCustomPose({Hips: {rotation: [0, 0, 0, 1]}} as any),
    libEntries,
    t,
  })
  expect(current).toBe('lib:lib-wave')
  expect(options[1]).toMatchObject({key: 'custom'})
})

test('当前自定义但无备份(旧工程):自定义选项仍在,当前自定义', () => {
  const {options, current} = buildPoseOptions({
    poseJson: serializeCustomPose({Hips: {rotation: [0, 0, 0, 1]}} as any),
    backupJson: '',
    libEntries,
    t,
  })
  expect(current).toBe('custom')
  expect(options.some((o) => o.key === 'custom')).toBe(true)
})

test('骨架不匹配:置灰并带提示;无骨架信息不过滤', () => {
  const {options} = buildPoseOptions({
    poseJson: '',
    backupJson: '',
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
    backupJson: '',
    libEntries,
    t,
  })
  expect(current).toBe('lib:lib-gone')
  const missing = options.find((o) => o.key === 'lib:lib-gone')!
  expect(missing.disabled).toBe(true)
  expect(missing.hint).toBeTruthy()
})
