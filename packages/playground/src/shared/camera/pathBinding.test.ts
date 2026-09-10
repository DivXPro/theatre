import {resolveBoundPathKey, isBindingStale} from './pathBinding'

const REG = ['Pos Path', 'Pos Path 2']

test('手动模式:不解析任何绑定', () => {
  expect(resolveBoundPathKey('manual', 'Pos Path 2', REG)).toBe(null)
  expect(isBindingStale('manual', '', REG)).toBe(false)
})

test('path 模式 + 已绑定的 key 在册 → 绑定生效', () => {
  expect(resolveBoundPathKey('path', 'Pos Path 2', REG)).toBe('Pos Path 2')
  expect(isBindingStale('path', 'Pos Path 2', REG)).toBe(false)
})

test('path 模式 + pathKey 为空 + legacy Pos Path 在册 → 回退 legacy(旧状态兼容)', () => {
  expect(resolveBoundPathKey('path', '', REG)).toBe('Pos Path')
  expect(isBindingStale('path', '', REG)).toBe(false)
})

test('path 模式 + pathKey 为空 + 无 legacy → 失效', () => {
  expect(resolveBoundPathKey('path', '', ['Pos Path 2'])).toBe(null)
  expect(isBindingStale('path', '', ['Pos Path 2'])).toBe(true)
})

test('path 模式 + 绑定的路径已不在册(被删/对端同步删)→ 失效', () => {
  expect(resolveBoundPathKey('path', 'Pos Path 3', REG)).toBe(null)
  expect(isBindingStale('path', 'Pos Path 3', REG)).toBe(true)
})
