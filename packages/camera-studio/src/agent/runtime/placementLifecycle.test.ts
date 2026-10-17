/**
 * placementLifecycle(2026-10-17,Task 8):key → deferred waiter 语义。
 *
 * waiter 在 setPendingEntry 前由 placeLibraryEntryAt 创建;
 * PlacedModelCore 在注册表提交 + onPersisted 后 resolvePlacementPersisted,
 * PlacedModelErrorBoundary 失败时 rejectPlacement;settle 后 waiter 立即
 * 从 Map 删除,resolve/reject 对未知 key(UI 放置路径没有 waiter)静默 no-op。
 */
import {
  createPlacementWaiter,
  hasPlacementWaiter,
  rejectPlacement,
  resolvePlacementPersisted,
} from './placementLifecycle'

test('create 后 pending;resolvePlacementPersisted 后 promise 兑现且 waiter 从 Map 删除', async () => {
  const persisted = createPlacementWaiter('k1')
  expect(hasPlacementWaiter('k1')).toBe(true)

  let settled = false
  void persisted.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)

  resolvePlacementPersisted('k1')
  await expect(persisted).resolves.toBeUndefined()
  expect(settled).toBe(true)
  expect(hasPlacementWaiter('k1')).toBe(false)
})

test('rejectPlacement 以原始错误 reject,并从 Map 删除', async () => {
  const persisted = createPlacementWaiter('k2')
  const failure = new Error('库模型加载失败')
  rejectPlacement('k2', failure)
  await expect(persisted).rejects.toBe(failure)
  expect(hasPlacementWaiter('k2')).toBe(false)
})

test('未知 key 的 resolve/reject 静默 no-op(UI 放置路径没有 waiter)', () => {
  expect(() => resolvePlacementPersisted('nope')).not.toThrow()
  expect(() => rejectPlacement('nope', new Error('x'))).not.toThrow()
  expect(hasPlacementWaiter('nope')).toBe(false)
})

test('settle 幂等:resolve 后的迟到 reject 不再生效', async () => {
  const persisted = createPlacementWaiter('k3')
  // 兜底消费,防万一实现退化成重复 reject 时出现 unhandled rejection
  const guarded = persisted.catch((err: unknown) => err)
  resolvePlacementPersisted('k3')
  rejectPlacement('k3', new Error('late failure'))
  await expect(persisted).resolves.toBeUndefined()
  await expect(guarded).resolves.toBeUndefined()
  expect(hasPlacementWaiter('k3')).toBe(false)
})

test('同 key 重复创建:旧 waiter 被拒绝(不悬挂),新 waiter 独立工作', async () => {
  const first = createPlacementWaiter('k4')
  const firstOutcome = first.then(
    () => 'resolved',
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  )
  const second = createPlacementWaiter('k4')
  // 旧 waiter 必须 settle(reject),否则等待方永远悬挂
  await expect(firstOutcome).resolves.toContain('取代')
  expect(hasPlacementWaiter('k4')).toBe(true)

  resolvePlacementPersisted('k4')
  await expect(second).resolves.toBeUndefined()
  expect(hasPlacementWaiter('k4')).toBe(false)
})
