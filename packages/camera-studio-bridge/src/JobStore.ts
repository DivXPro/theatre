/**
 * HTTP 任务投影(spec 8.7、10.1,Task 5)。
 *
 * 职责:
 * - `upsert`:接收浏览器 job 事件快照(经 SceneSession 代次闸门与形状
 *   校验后进入)和 httpServer 的 accepted 初始快照;终态
 *   (succeeded/failed/cancelled)是粘性的,迟到事件绝不覆盖终态,
 *   accepted 初始快照也不回退已推进的任务;
 * - `get`:`GET /v1/jobs/:id` 的读取出口,未知任务返回 undefined
 *   (由路由层映射 404 JOB_NOT_FOUND);
 * - `cancel`:只有 cancelable 且非终态的任务才转发 `jobs.cancel` 命令
 *   (经注入的 execute 复用 SceneSession.execute,requestId 由桥接生成
 *   并带 `cancel-` 前缀,不与 Agent 请求冲突);转发成功后返回当前快照
 *   ——HTTP 不假装已取消,浏览器 job 快照事件才是权威;已 cancelled 的
 *   任务是幂等读,不重复转发;
 * - `failAllForScene`:页面断连时把 pending/running 统一转为 failed
 *   (error.code 由调用方给,SCENE_UNAVAILABLE),只改非终态。
 *
 * 本模块不感知 sessionId:代次闸门在 SceneSession(只转发当前会话的
 * job 事件);快照持久性为进程内存,不承诺跨桥接重启保存。
 */

import {randomUUID} from 'crypto'
import {BridgeHttpError, httpStatusForErrorCode} from './errors'
import type {BridgeJobsHandle} from './httpServer'
import type {BridgeJobSnapshot, CommandRequest, CommandResponse} from './types'

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'cancelled',
])

export type JobStore = BridgeJobsHandle & {
  /** 把全部非终态任务转为 failed,error.code 取参数;终态不被覆盖 */
  failAllForScene(code: string): void
}

export type JobStoreDeps = {
  /** 取消转发出口;真实实现是 SceneSession.execute(闭包延迟读取) */
  execute(request: CommandRequest): Promise<CommandResponse>
}

export function createJobStore(deps: JobStoreDeps): JobStore {
  const jobs = new Map<string, BridgeJobSnapshot>()

  return {
    upsert(snapshot: BridgeJobSnapshot): void {
      const existing = jobs.get(snapshot.jobId)
      if (existing !== undefined) {
        // 终态粘性:任何迟到事件都不得覆盖终态
        if (TERMINAL_STATES.has(existing.state)) return
        // accepted 初始快照不得回退已推进的任务(结果与进度事件可乱序)
        if (snapshot.state === 'pending' && existing.state !== 'pending') {
          return
        }
      }
      jobs.set(snapshot.jobId, snapshot)
    },

    get(jobId: string): BridgeJobSnapshot | undefined {
      return jobs.get(jobId)
    },

    async cancel(jobId: string): Promise<BridgeJobSnapshot> {
      const snapshot = jobs.get(jobId)
      if (snapshot === undefined) {
        throw new BridgeHttpError(404, 'JOB_NOT_FOUND', '任务不存在')
      }
      // 已取消是幂等读:直接返回快照,不重复转发 jobs.cancel
      if (snapshot.state === 'cancelled') return snapshot
      if (TERMINAL_STATES.has(snapshot.state) || !snapshot.cancelable) {
        throw new BridgeHttpError(
          409,
          'JOB_NOT_CANCELABLE',
          '任务不支持取消或已结束',
        )
      }
      const response = await deps.execute({
        requestId: `cancel-${randomUUID()}`,
        name: 'jobs.cancel',
        args: {jobId},
      })
      if (!response.ok) {
        // 转发失败(如 SCENE_UNAVAILABLE):透传浏览器错误,
        // 本地快照不变
        throw new BridgeHttpError(
          httpStatusForErrorCode(response.error.code),
          response.error.code,
          response.error.message,
          {retryable: response.error.retryable},
        )
      }
      // HTTP 不假装已取消:返回当前快照,终态以浏览器 job 事件为准
      return jobs.get(jobId) ?? snapshot
    },

    failAllForScene(code: string): void {
      for (const [jobId, snapshot] of jobs) {
        if (TERMINAL_STATES.has(snapshot.state)) continue
        jobs.set(jobId, {
          ...snapshot,
          state: 'failed',
          error: {
            code,
            message: '浏览器场景断连,任务终止',
            retryable: true,
          },
        })
      }
    },
  }
}
