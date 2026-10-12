/**
 * 本地等价实现,取代 \@dreamerbird/utils/getDeep——该包 private 未发布,
 * 不能成为本包的运行时依赖(peerDeps 完整性核对时收编,2026-10-12)。
 * 按路径数组逐段取值;路径为空返回原值,任一段不存在返回 undefined,
 * 与原实现(lodash-es/get 包装)在调用点的语义一致。
 */
export default function getDeep(
  v: unknown,
  path: readonly (string | number)[],
): unknown {
  let cur: unknown = v
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[key]
  }
  return cur
}
