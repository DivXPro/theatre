// packages/playground/src/shared/camera/pathRegistry.test.ts
import {nextPathEntry, parsePathEntries} from './pathRegistry'

describe('parsePathEntries', () => {
  test('解析合法清单;坏 JSON/非数组回退空', () => {
    expect(parsePathEntries('[]')).toEqual([])
    const one = [{pathKey: 'Pos Path'}]
    expect(parsePathEntries(JSON.stringify(one))).toEqual(one)
    expect(parsePathEntries('not json')).toEqual([])
    expect(parsePathEntries('{"a":1}')).toEqual([])
  })
  test('过滤畸形项', () => {
    expect(
      parsePathEntries('[{"pathKey":"A"},{"foo":"bar"},{"pathKey":1}]'),
    ).toEqual([{pathKey: 'A'}])
  })
})

describe('nextPathEntry', () => {
  test('空清单给第一条(兼容既有状态的 key)', () => {
    expect(nextPathEntry([])).toEqual({pathKey: 'Pos Path'})
  })
  test('占用后递增编号,跳过已用的', () => {
    const existing = [{pathKey: 'Pos Path'}, {pathKey: 'Pos Path 3'}]
    expect(nextPathEntry(existing)).toEqual({pathKey: 'Pos Path 2'})
  })
})
