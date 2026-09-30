// packages/playground/src/shared/camera/anchorsRegistry.test.ts
import {
  parseAnchorKeys,
  nextAnchorKey,
  stashAnchorSeed,
  consumeAnchorSeed,
} from './anchorsRegistry'

describe('parseAnchorKeys', () => {
  test('合法清单;坏 JSON/非数组/非字符串项回退', () => {
    expect(parseAnchorKeys('["Anchor 1","Anchor 2"]')).toEqual([
      'Anchor 1',
      'Anchor 2',
    ])
    expect(parseAnchorKeys('not json')).toEqual([])
    expect(parseAnchorKeys('{"a":1}')).toEqual([])
    expect(parseAnchorKeys('[1,"Anchor 1",null]')).toEqual(['Anchor 1'])
  })
})

describe('nextAnchorKey', () => {
  test('空清单给 Anchor 1;占用后取第一个空位', () => {
    expect(nextAnchorKey([])).toBe('Anchor 1')
    expect(nextAnchorKey(['Anchor 1', 'Anchor 2'])).toBe('Anchor 3')
    expect(nextAnchorKey(['Anchor 1', 'Anchor 3'])).toBe('Anchor 2')
  })
})

describe('anchor seed', () => {
  test('存取一次即清;未存的 key 返回 undefined', () => {
    stashAnchorSeed('Anchor 1', {position: {x: 1, y: 2, z: 3}})
    expect(consumeAnchorSeed('Anchor 1')).toEqual({
      position: {x: 1, y: 2, z: 3},
    })
    expect(consumeAnchorSeed('Anchor 1')).toBeUndefined()
  })
})
