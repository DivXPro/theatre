/**
 * 姿势状态行文案(spec §6.2):空/非法=绑定;custom=自定义;lib=库:名称
 * (条目缺失显示 id,告警与回退由 resolve 层负责)。
 */
import {poseStatusText} from './poseStatusText'

const t = (k: string) =>
  ({
    'pg.pose.statusBind': '绑定姿势',
    'pg.pose.statusCustom': '自定义姿势',
    'pg.pose.statusLibPrefix': '库:',
  })[k] ?? k

test('空与非法 JSON = 绑定姿势', () => {
  expect(poseStatusText('', null, t)).toBe('绑定姿势')
  expect(poseStatusText('{oops', null, t)).toBe('绑定姿势')
})

test('custom = 自定义姿势', () => {
  expect(poseStatusText('{"kind":"custom","bones":{}}', null, t)).toBe(
    '自定义姿势',
  )
})

test('lib = 库:名称(名称缺失回退 id)', () => {
  expect(poseStatusText('{"kind":"lib","id":"p1"}', '挥手', t)).toBe('库:挥手')
  expect(poseStatusText('{"kind":"lib","id":"p1"}', null, t)).toBe('库:p1')
})
