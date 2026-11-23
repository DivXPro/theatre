import {dedupeAnimations} from './animationDedupe'

type Row = {
  name: string
  contentHash: string
  fingerprint: string
  packSize: number
}

const row = (
  name: string,
  contentHash: string,
  fingerprint: string,
  packSize = 10,
): Row => ({name, contentHash, fingerprint, packSize})

describe('dedupeAnimations', () => {
  test('同一动画数据只保留一份,其余条目带上保留项', () => {
    const kept = row('Mixamo Locomotion - Walking', 'h-walk', 'fp-walk', 12)
    const dup = row(
      'Mixamo Male Locomotion - Walking',
      'h-walk2',
      'fp-walk',
      10,
    )
    const idle = row('Mixamo Locomotion - Idle', 'h-idle', 'fp-idle', 12)

    const result = dedupeAnimations([kept, dup, idle])

    expect(result.kept).toEqual([kept, idle])
    expect(result.duplicates).toEqual([{row: dup, canonical: kept}])
  })

  test('同组优先保留动作更多的包', () => {
    const small = row('Mixamo Longbow Locomotion - Idle', 'h-a', 'fp', 12)
    const large = row('Mixamo Pro Longbow - Idle', 'h-b', 'fp', 39)

    const result = dedupeAnimations([small, large])

    expect(result.kept).toEqual([large])
    expect(result.duplicates).toEqual([{row: small, canonical: large}])
  })

  test('重复包让位给正式包', () => {
    const basic = row('Mixamo Basic Locomotion - Idle', 'h-basic', 'fp', 7)
    const free = row('Mixamo Free Test - Idle', 'h-free', 'fp', 11)

    const result = dedupeAnimations([free, basic])

    expect(result.kept).toEqual([basic])
    expect(result.duplicates).toEqual([{row: free, canonical: basic}])
  })

  test('无重复时原样返回并保持顺序', () => {
    const rows = [
      row('Mixamo Locomotion - Idle', 'h1', 'fp1'),
      row('Mixamo Pro Magic - Cast', 'h2', 'fp2'),
    ]

    expect(dedupeAnimations(rows)).toEqual({kept: rows, duplicates: []})
  })

  test('三条相同时保留一条,两条记为重复', () => {
    const a = row('Mixamo Locomotion - Walk', 'h1', 'fp', 12)
    const b = row('Mixamo Free Test - Walk', 'h2', 'fp', 11)
    const c = row('Mixamo Male Locomotion - Walk', 'h3', 'fp', 10)

    const result = dedupeAnimations([a, b, c])

    expect(result.kept).toEqual([a])
    expect(result.duplicates.map((d) => d.row.contentHash)).toEqual([
      'h2',
      'h3',
    ])
  })
})
