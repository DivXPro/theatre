/**
 * 姿势会话运行时(2026-10-17,Task 9):PoseModeRig 挂载后按 placementKey
 * 登记提交/取消句柄,Agent `poses.session.*` 命令经此调用——与 UI 的
 * Esc/双击空白退出同一条提交路径(句柄由 Rig 的挂载 effect 注册,
 * 卸载即注销,绝不读到陈旧闭包)。
 *
 * `whenPoseSessionRig` 是 `poses.session.start` 的 completion:mounted
 * 等待:Rig 登记即兑现;会话在登记前被清(防御路径:无根骨/无装配表
 * 时 PoseModeRig 直接 clearPoseSession)或切换到别的模型时,等待方以
 * INVALID_STATE 拒绝,不悬挂。
 *
 * 模块级表与 objectRuntime/placementLifecycle 同模式:单页单场景。
 */
import {AgentApiError} from '../errors'
import {onPoseSessionChange} from '../../poseMode/poseSession'

/** PoseModeRig 登记的会话句柄 */
export type PoseSessionRigHandlers = {
  /** 提交:脏检查 → 捕获实时骨骼写姿势帧(可撤销)→ 清会话 */
  commit: () => void
  /** 取消:不写回直接清会话(姿势应用 effect 把当前值补刷回骨骼) */
  cancel: () => void
}

type RigWaiter = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

const rigs = new Map<string, PoseSessionRigHandlers>()
const waiters = new Map<string, RigWaiter>()

// 会话生灭看护:等待中的 key 对应的会话消失/被切换时,拒绝其 waiter。
// 模块级单次订阅(单页单会话,同 poseSession 的全局唯一语义)。
onPoseSessionChange((session) => {
  for (const [key, waiter] of waiters) {
    if (session?.key === key) continue
    waiters.delete(key)
    waiter.reject(
      new AgentApiError(
        'INVALID_STATE',
        `姿势会话未能建立:模型 ${key} 的 Rig 未挂载`,
        {details: {key}},
      ),
    )
  }
})

/** PoseModeRig 挂载 effect 调用;返回注销函数(组件卸载时调用) */
export function registerPoseSessionRig(
  key: string,
  handlers: PoseSessionRigHandlers,
): () => void {
  rigs.set(key, handlers)
  const waiter = waiters.get(key)
  if (waiter) {
    waiters.delete(key)
    waiter.resolve()
  }
  return () => {
    // 仅当登记的还是同一句柄才删:A→B 切换时 A 的迟到注销不抹掉 B
    if (rigs.get(key) === handlers) rigs.delete(key)
  }
}

/** 当前登记的 Rig 句柄;未挂载为 undefined */
export function getPoseSessionRig(
  key: string,
): PoseSessionRigHandlers | undefined {
  return rigs.get(key)
}

/**
 * 等待某 placement key 的 Rig 登记;已登记立即兑现。
 * 同 key 重复等待复用同一 promise(幂等 start)。
 */
export function whenPoseSessionRig(key: string): Promise<void> {
  if (rigs.has(key)) return Promise.resolve()
  const existing = waiters.get(key)
  if (existing) return existing.promise
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  waiters.set(key, {promise, resolve, reject})
  return promise
}
