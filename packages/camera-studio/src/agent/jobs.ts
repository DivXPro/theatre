/**
 * Agent 任务管理器(2026-10-17,spec 8.7):长任务的登记、进度、终态和取消。
 * 管理器保存每个任务的最后一个快照,并向订阅者发送不可变副本;
 * `done` promise 是任务终态的唯一权威。
 */
import {AgentApiError, asAgentApiError} from './errors'
import type {JobSnapshot} from './types'

/** 订阅者收到的快照:与 `get` 返回同一冻结对象 */
export type JobListener = (snapshot: JobSnapshot<unknown>) => void

/** `execute` 收到的控制句柄:AbortSignal + 进度/阶段上报 */
export type JobControls = {
  signal: AbortSignal
  update: (patch: {progress?: number; phase?: JobSnapshot['phase']}) => void
}

/** 终态之后不再接受 update/cancel */
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled'])

let jobIdFallbackCounter = 0

/**
 * 任务 ID:优先 `crypto.randomUUID()`;运行环境缺失(如旧 jsdom)
 * 时回退为带进程内计数器的 `job-${Date.now()}-${counter}`。
 */
function newJobId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  jobIdFallbackCounter += 1
  return `job-${Date.now()}-${jobIdFallbackCounter}`
}

function errorDetails(error: AgentApiError): NonNullable<JobSnapshot['error']> {
  const details: NonNullable<JobSnapshot['error']> = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  }
  if (error.details !== undefined) details.details = error.details
  return details
}

export class AgentJobManager {
  private readonly snapshots = new Map<string, JobSnapshot<unknown>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<JobListener>()

  /**
   * 发布最新快照:冻结后存表并广播。当前快照已是终态时
   * (如取消后 execute 晚到 settle)不再覆盖,返回当前快照。
   */
  private emit(
    jobId: string,
    snapshot: JobSnapshot<unknown>,
  ): JobSnapshot<unknown> {
    const current = this.snapshots.get(jobId)
    if (current && TERMINAL_STATES.has(current.state)) return current
    const frozen = Object.freeze(snapshot)
    this.snapshots.set(jobId, frozen)
    // 单个订阅者抛错不得中断广播,也不得反向污染任务状态
    // (异常若传回 execute 调用点,会被 start 的 catch 误判为任务失败)
    for (const listener of [...this.listeners]) {
      try {
        listener(frozen)
      } catch {
        // 忽略:后续订阅者仍应收到本快照
      }
    }
    return frozen
  }

  /**
   * 启动任务并立即返回句柄;同步发布 `running` 快照后开始执行。
   * `done` 在 execute settle 后以终态快照 resolve。
   */
  start<T>(args: {
    kind: string
    cancelable: boolean
    execute: (controls: JobControls) => Promise<T>
  }): {jobId: string; done: Promise<JobSnapshot<T>>} {
    const jobId = newJobId()
    const controller = new AbortController()
    this.controllers.set(jobId, controller)

    this.emit(jobId, {
      jobId,
      kind: args.kind,
      state: 'running',
      progress: 0,
      phase: 'accepted',
      cancelable: args.cancelable,
    })

    const done = (async (): Promise<JobSnapshot<T>> => {
      try {
        const result = await args.execute({
          signal: controller.signal,
          update: (patch) => {
            const current = this.snapshots.get(jobId)!
            this.emit(jobId, {
              ...current,
              progress: patch.progress ?? current.progress,
              phase: patch.phase ?? current.phase,
            })
          },
        })
        const current = this.snapshots.get(jobId)!
        this.emit(jobId, {...current, state: 'succeeded', progress: 1, result})
      } catch (error) {
        const current = this.snapshots.get(jobId)!
        const normalized = asAgentApiError(error)
        // execute 以 JOB_CANCELLED 拒绝 = 任务因取消而结束(如视频导出的
        // 用户侧中止:Esc/开录相机被删,非 jobs.cancel 路径)——终态应为
        // cancelled 并带上错误码,轮询方据此区分"被中止"与真失败;
        // 若已是 cancelled(jobs.cancel 先到),emit 的终态保护保持原样
        if (normalized.code === 'JOB_CANCELLED') {
          this.emit(jobId, {
            ...current,
            state: 'cancelled',
            error: errorDetails(normalized),
          })
        } else {
          this.emit(jobId, {
            ...current,
            state: 'failed',
            error: errorDetails(normalized),
          })
        }
      }
      return this.snapshots.get(jobId) as JobSnapshot<T>
    })()

    return {jobId, done}
  }

  /** 返回该任务的最新冻结快照;未知 ID 抛 `JOB_NOT_FOUND` */
  get<T = unknown>(jobId: string): JobSnapshot<T> {
    const snapshot = this.snapshots.get(jobId)
    if (!snapshot) {
      throw new AgentApiError('JOB_NOT_FOUND', `未知任务: ${jobId}`)
    }
    return snapshot as JobSnapshot<T>
  }

  /**
   * 取消任务:触发 `AbortController.abort()` 并立即映射为
   * `cancelled`。不可取消任务抛 `JOB_NOT_CANCELABLE`,
   * 未知 ID 抛 `JOB_NOT_FOUND`,已结束任务抛 `INVALID_STATE`。
   */
  cancel(jobId: string): void {
    const snapshot = this.snapshots.get(jobId)
    if (!snapshot) {
      throw new AgentApiError('JOB_NOT_FOUND', `未知任务: ${jobId}`)
    }
    if (!snapshot.cancelable) {
      throw new AgentApiError('JOB_NOT_CANCELABLE', `任务不可取消: ${jobId}`)
    }
    if (TERMINAL_STATES.has(snapshot.state)) {
      throw new AgentApiError('INVALID_STATE', `任务已结束,无法取消: ${jobId}`)
    }
    this.controllers.get(jobId)?.abort()
    this.emit(jobId, {...snapshot, state: 'cancelled'})
  }

  /** 订阅全部任务快照;返回解绑函数 */
  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
