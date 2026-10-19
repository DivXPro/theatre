/**
 * 放置挂载等待(2026-10-17,Task 8):key → deferred waiter。
 *
 * Agent `models.create` 的 completion:mounted 靠它兑现:
 * `placeLibraryEntryAt` 在 `setPendingEntry` 之前创建 waiter 并随
 * `{key, persisted}` 返回;`PlacedModelCore` 在注册表提交 + `onPersisted()`
 * 之后 `resolvePlacementPersisted(key)`;`PlacedModelErrorBoundary` 在
 * 加载/渲染失败时 `rejectPlacement(key, err)`;pending 条目未持久化即卸载
 * 时由 persist effect 的 cleanup 拒绝,等待方不悬挂。
 *
 * waiter settle 后立即从 Map 删除(settle 幂等由此而来);resolve/reject
 * 对未知 key 静默 no-op —— UI 放置路径(confirmPlacing 等)不创建 waiter。
 *
 * 模块级表与 placementObjects/objectRuntime 同模式:单页单场景。
 */

type PlacementWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
}

const waiters = new Map<string, PlacementWaiter>()

/**
 * 创建某 placement key 的挂载等待器,返回 persisted promise。
 * 同 key 已有未 settle 的 waiter 时先拒绝旧的(它的挂载永远不会来了),
 * 以新 waiter 为准 —— 旧等待方 settle 为失败,不悬挂。
 */
export function createPlacementWaiter(key: string): Promise<void> {
  rejectPlacement(key, new Error(`放置等待被同 key 的新放置取代: ${key}`))
  let resolvePromise!: () => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  waiters.set(key, {
    resolve: () => {
      // 先删后兑现:settle 后 Map 不留条目,重复 settle 自然 no-op
      waiters.delete(key)
      resolvePromise()
    },
    reject: (error: unknown) => {
      waiters.delete(key)
      rejectPromise(error)
    },
  })
  return promise
}

/** 注册表提交 + onPersisted 之后由 PlacedModelCore 调用;未知 key no-op */
export function resolvePlacementPersisted(key: string): void {
  waiters.get(key)?.resolve()
}

/** 挂载/加载失败或提前卸载时拒绝;未知 key no-op */
export function rejectPlacement(key: string, error: unknown): void {
  waiters.get(key)?.reject(error)
}

/** 该 key 是否有未 settle 的 waiter(测试与调试用) */
export function hasPlacementWaiter(key: string): boolean {
  return waiters.has(key)
}

/**
 * 会话拆解兜底(2026-10-19,Task 15):拒绝全部未 settle 的 waiter。
 * dispose 不伴随 React 卸载的路径(如桥接直连 teardown)上,组件 cleanup
 * 不会运行,pending waiter 必须由此拒绝(API_DISPOSED),等待方不悬挂。
 */
export function rejectAllPlacements(error: unknown): void {
  for (const key of [...waiters.keys()]) rejectPlacement(key, error)
}
