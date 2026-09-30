import {resolveBoundPathKey, isBindingStale} from './pathBinding'

const REG = ['Pos Path', 'Pos Path 2']

test('pathKey 为空 = 手动,不解析任何绑定', () => {
  expect(resolveBoundPathKey('', REG)).toBe(null)
  expect(isBindingStale('', REG)).toBe(false)
})

test('pathKey 在册 → 绑定生效', () => {
  expect(resolveBoundPathKey('Pos Path 2', REG)).toBe('Pos Path 2')
  expect(isBindingStale('Pos Path 2', REG)).toBe(false)
})

test('pathKey 不在册(被删/对端同步删)→ 失效', () => {
  expect(resolveBoundPathKey('Pos Path 3', REG)).toBe(null)
  expect(isBindingStale('Pos Path 3', REG)).toBe(true)
})
