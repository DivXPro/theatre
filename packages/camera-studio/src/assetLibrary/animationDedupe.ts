/**
 * 内置动作剔重:同一段动画可能被多个 Mixamo 包重复收录(如
 * Locomotion / Basic Locomotion / Male Locomotion 的 Walking)。
 * 按动画数据指纹分组后只保留一条,其余内容哈希作为别名交给目录源
 * 解析——场景里已引用的旧条目 id 仍然能取到同一条动画。
 */
export type AnimationDedupeRow = {
  /** 条目显示名(含包前缀,如 "Mixamo Locomotion - Walking") */
  name: string
  /** 动画轨道数据指纹(不含文件名/包名) */
  fingerprint: string
  /** 所在包的动作数量:重复时优先保留更完整的包 */
  packSize: number
}

export type AnimationDuplicates<T> = Array<{row: T; canonical: T}>

export type AnimationDedupeResult<T> = {
  kept: T[]
  duplicates: AnimationDuplicates<T>
}

/** 演示/重复包优先级:数字越大越先被替代 */
const REDUNDANT_PACK_RANK: Array<[RegExp, number]> = [
  [/^Mixamo Free Test - /, 2],
  [/^Mixamo (?:Basic|Magic|Male|Female)(?: Basic)? Locomotion - /, 1],
]

function redundancyRank(name: string): number {
  for (const [pattern, rank] of REDUNDANT_PACK_RANK) {
    if (pattern.test(name)) return rank
  }
  return 0
}

function compareCandidates<T extends AnimationDedupeRow>(a: T, b: T): number {
  return (
    Number(a.packSize > 0) - Number(b.packSize > 0) ||
    redundancyRank(a.name) - redundancyRank(b.name) ||
    b.packSize - a.packSize ||
    a.name.localeCompare(b.name)
  )
}

export function dedupeAnimations<T extends AnimationDedupeRow>(
  rows: readonly T[],
): AnimationDedupeResult<T> {
  const canonicalByFingerprint = new Map<string, T>()
  for (const row of rows) {
    const canonical = canonicalByFingerprint.get(row.fingerprint)
    if (!canonical || compareCandidates(row, canonical) < 0) {
      canonicalByFingerprint.set(row.fingerprint, row)
    }
  }
  const duplicates: AnimationDuplicates<T> = []
  const kept: T[] = []
  for (const row of rows) {
    const canonical = canonicalByFingerprint.get(row.fingerprint)!
    if (row === canonical) kept.push(row)
    else duplicates.push({row, canonical})
  }
  return {kept, duplicates}
}
