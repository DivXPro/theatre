/**
 * 相机/锚点挂载等待(2026-10-17,Task 10):key → deferred waiter,
 * 与 placementLifecycle 同模式。
 *
 * Agent `cameras.create` / `anchors.create` 的 completion:mounted 靠它
 * 兑现:命令在 Scene Runtime handler 同步写注册表并返回 key 后创建
 * waiter;`ShotCamera` / `AnchorObject` 的种子 layout effect 结束时
 * `notifyCameraReady` / `notifyAnchorReady`(没有 seed 的恢复对象同样
 * 通知,不重复写值);组件在 waiter 未 settle 时卸载则 reject,
 * 等待方不悬挂。
 *
 * waiter settle 后立即从 Map 删除(settle 幂等由此而来);notify/reject
 * 对未知 key 静默 no-op —— UI 的添加相机/锚点路径不创建 waiter。
 *
 * 模块级表与 placementLifecycle/objectRuntime 同模式:单页单场景。
 */

type MountWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
}

function makeMountLifecycle(label: string) {
  const waiters = new Map<string, MountWaiter>()
  return {
    /**
     * 创建某 key 的挂载等待器,返回 ready promise。
     * 同 key 已有未 settle 的 waiter 时先拒绝旧的(它的挂载永远不会来了),
     * 以新 waiter 为准 —— 旧等待方 settle 为失败,不悬挂。
     */
    create(key: string): Promise<void> {
      waiters
        .get(key)
        ?.reject(new Error(`${label}挂载等待被同 key 的新创建取代: ${key}`))
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
    },
    /** 挂载对象的种子 layout effect 结束后调用;未知 key no-op */
    notify(key: string): void {
      waiters.get(key)?.resolve()
    },
    /** waiter 未 settle 组件即卸载时拒绝;未知 key no-op */
    reject(key: string, error: unknown): void {
      waiters.get(key)?.reject(error)
    },
    /** 该 key 是否有未 settle 的 waiter(测试与调试用) */
    has(key: string): boolean {
      return waiters.has(key)
    },
    /**
     * 会话拆解兜底(Task 15):拒绝全部未 settle 的 waiter。
     * dispose 不伴随组件卸载时,pending waiter 由此拒绝,不悬挂。
     */
    rejectAll(error: unknown): void {
      for (const key of [...waiters.keys()]) {
        waiters.get(key)?.reject(error)
      }
    },
  }
}

const cameraLifecycle = makeMountLifecycle('相机')
const anchorLifecycle = makeMountLifecycle('锚点')

/** cameras.create 在 handler 返回 key 后创建;resolve 于 ShotCamera 挂载就绪 */
export function createCameraWaiter(cameraKey: string): Promise<void> {
  return cameraLifecycle.create(cameraKey)
}

/** ShotCamera 的种子 layout effect 结束(含无 seed 的恢复对象)时调用 */
export function notifyCameraReady(cameraKey: string): void {
  cameraLifecycle.notify(cameraKey)
}

/** ShotCamera 在 waiter 未 settle 时卸载调用;无 waiter 时 no-op */
export function rejectCameraMount(cameraKey: string, error: unknown): void {
  cameraLifecycle.reject(cameraKey, error)
}

/** 该 cameraKey 是否有未 settle 的 waiter(测试与调试用) */
export function hasCameraWaiter(cameraKey: string): boolean {
  return cameraLifecycle.has(cameraKey)
}

/** 会话拆解时拒绝全部未 settle 的相机挂载 waiter(Task 15) */
export function rejectAllCameraMounts(error: unknown): void {
  cameraLifecycle.rejectAll(error)
}

/** anchors.create 在 handler 返回 key 后创建;resolve 于 AnchorObject 挂载就绪 */
export function createAnchorWaiter(anchorKey: string): Promise<void> {
  return anchorLifecycle.create(anchorKey)
}

/** AnchorObject 的种子 layout effect 结束(含无 seed 的恢复对象)时调用 */
export function notifyAnchorReady(anchorKey: string): void {
  anchorLifecycle.notify(anchorKey)
}

/** AnchorObject 在 waiter 未 settle 时卸载调用;无 waiter 时 no-op */
export function rejectAnchorMount(anchorKey: string, error: unknown): void {
  anchorLifecycle.reject(anchorKey, error)
}

/** 该 anchorKey 是否有未 settle 的 waiter(测试与调试用) */
export function hasAnchorWaiter(anchorKey: string): boolean {
  return anchorLifecycle.has(anchorKey)
}

/** 会话拆解时拒绝全部未 settle 的锚点挂载 waiter(Task 15) */
export function rejectAllAnchorMounts(error: unknown): void {
  anchorLifecycle.rejectAll(error)
}
