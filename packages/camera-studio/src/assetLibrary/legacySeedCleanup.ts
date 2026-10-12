import type {Library} from './library'

/**
 * 旧播种条目清理(2026-10-10):内置资产改目录源后,旧用户浏览器里
 * 已播种的 seed-pose-* 条目静默删一次——目录沿用同 id,场景里的姿势
 * 引用经聚合读无缝续命。旧播种的模型条目保留:它们的 id 是当年导入
 * 管线随机串,场景放置直接引用,删了旧场景就断;目录模型按内容寻址
 * 去重,不会因此重复计数。
 *
 * 实现注记(枚举走可写源自身,不经聚合门面):聚合 listEntries 带
 * 内置命名空间守护——可写源里的 seed-pose- 与 seed-model- 前缀条目
 * 会被剔除出列表与 id→源映射(library.ts「可写源不允许内置前缀条目」),
 * 经聚合面永远拿不到「可写源持有的 seed-pose-*」这一视角;故直接列
 * 可写源原始清单。删除仍走门面 deleteEntry:写队列串行 + 变更通知,
 * 与导入/清扫不交错。
 */
export async function cleanupLegacySeeds(
  lib: Library,
): Promise<{removed: number}> {
  const FLAG = 'theatre.cameraStudio.legacySeedCleanup.v1'
  try {
    if (globalThis.localStorage?.getItem(FLAG)) return {removed: 0}
  } catch {
    /* 无 localStorage 环境照样跑,删除本身幂等 */
  }
  let removed = 0
  const writable = lib.writable
  if (writable) {
    for (const e of await writable.listEntries()) {
      if (e.id.startsWith('seed-pose-')) {
        await lib.deleteEntry(e.id)
        removed++
      }
    }
  }
  try {
    globalThis.localStorage?.setItem(FLAG, '1')
  } catch {
    /* 同上 */
  }
  return {removed}
}
