/**
 * Agent API 稳定错误类别(2026-10-17,spec 第 12 节):
 * `code` 是 Agent 分支判断的稳定依据,HTTP 状态码只表达传输/结果类别。
 * `KEYFRAME_NOT_FOUND` 为命令额外声明的子类错误码。
 */

/** spec 第 12 节全部错误码 + `KEYFRAME_NOT_FOUND` */
export const AGENT_API_ERROR_CODES = [
  'API_NOT_READY',
  'API_DISPOSED',
  'SCENE_UNAVAILABLE',
  'COMMAND_NOT_FOUND',
  'CAPABILITY_UNAVAILABLE',
  'INVALID_ARGUMENT',
  'INVALID_ID_KIND',
  'OBJECT_NOT_FOUND',
  'ASSET_NOT_FOUND',
  'PATH_POINT_NOT_FOUND',
  'KEYFRAME_NOT_FOUND',
  'INVALID_STATE',
  'REVISION_CONFLICT',
  'JOB_NOT_FOUND',
  'JOB_NOT_CANCELABLE',
  'JOB_CANCELLED',
  'FILE_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'STORAGE_ERROR',
  'NETWORK_ERROR',
  'RESOURCE_LOAD_FAILED',
  'PARTIAL_FAILURE',
  'INTERNAL_ERROR',
] as const

export type AgentApiErrorCode = (typeof AGENT_API_ERROR_CODES)[number]

/** 结构化 API 错误:JS 侧直接 throw,HTTP 侧由桥接转成失败结果 */
export class AgentApiError extends Error {
  readonly code: AgentApiErrorCode
  readonly retryable: boolean
  readonly details?: unknown

  constructor(
    code: AgentApiErrorCode,
    message: string,
    {retryable = false, details}: {retryable?: boolean; details?: unknown} = {},
  ) {
    super(message)
    this.name = 'AgentApiError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

/**
 * 未知异常归一化:已有结构化错误原样保留,
 * 其余一律包装为 `INTERNAL_ERROR`(非重试,带上原始信息)。
 */
export function asAgentApiError(error: unknown): AgentApiError {
  if (error instanceof AgentApiError) return error
  if (error instanceof Error) {
    return new AgentApiError('INTERNAL_ERROR', error.message, {
      details: {cause: error.message},
    })
  }
  return new AgentApiError('INTERNAL_ERROR', '未知错误', {
    details: {cause: String(error)},
  })
}
