/**
 * requestId 去重(spec 8.5,Task 4)。
 *
 * - 写命令在同一桥接和场景会话内按 requestId 去重:同 requestId 的在途
 *   和已完成请求共享第一次的结果(失败结果同样共享),不重复执行;
 * - 同 requestId 但 fingerprint 不同(name/args 不一致)→ INVALID_STATE,
 *   调用者修正参数必须更换 requestId;
 * - query 不进本缓存(调用方按 schema 的 kind 决定是否经过这里);
 * - 缓存为有界 LRU(默认 1000 条),命中刷新位置,超出容量驱逐最久未用;
 * - 去重不承诺跨桥接重启持久保存(进程内存实现)。
 */

import type {CommandFailure, CommandRequest, CommandResponse} from './types'

export const REQUEST_DEDUP_DEFAULT_CAPACITY = 1000

/**
 * stable stringify:递归排序对象键,数组保持顺序。
 * 只处理 JSON 值(args 来自 JSON body);undefined/函数等非 JSON 值不在
 * 契约内,按 JSON.stringify 的语义序列化。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
  )
  return `{${parts.join(',')}}`
}

/** 去重指纹:name + args 的 stable stringify(requestId 本身是键,不参与) */
export function commandFingerprint(request: CommandRequest): string {
  return stableStringify({name: request.name, args: request.args})
}

function requestIdConflict(requestId: string): CommandFailure {
  return {
    ok: false,
    error: {
      code: 'INVALID_STATE',
      message: 'requestId 已用于不同的 name/args;修正参数请更换 requestId',
      retryable: false,
      details: {requestId, conflict: 'requestId 冲突'},
    },
  }
}

type Entry = {
  fingerprint: string
  promise: Promise<CommandResponse>
}

export class RequestDeduplicator {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly capacity: number = REQUEST_DEDUP_DEFAULT_CAPACITY,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `RequestDeduplicator capacity must be a positive integer, got ${String(
          capacity,
        )}`,
      )
    }
  }

  /**
   * 同 requestId:命中缓存(在途或已完成)时返回第一次的 promise;
   * fingerprint 冲突时不执行 fn,直接返回 INVALID_STATE。
   */
  execute(
    request: CommandRequest,
    fn: () => Promise<CommandResponse>,
  ): Promise<CommandResponse> {
    const fingerprint = commandFingerprint(request)
    const existing = this.entries.get(request.requestId)
    if (existing !== undefined) {
      // LRU:命中(含冲突命中)刷新到最新位置
      this.entries.delete(request.requestId)
      this.entries.set(request.requestId, existing)
      if (existing.fingerprint !== fingerprint) {
        return Promise.resolve(requestIdConflict(request.requestId))
      }
      return existing.promise
    }
    const promise = fn()
    this.entries.set(request.requestId, {fingerprint, promise})
    // Map 迭代顺序即插入/刷新顺序:队首是最久未使用的条目
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
    return promise
  }
}
