/**
 * HTTP 统一错误映射(spec 第 8.3、12 节)。
 *
 * `error.code` 是 Agent 分支判断的稳定依据,HTTP 状态码只表达传输/结果
 * 类别。写响应时只序列化 code/message/retryable/details 四个字段——
 * 绝不把 stack 或其他内部字段返回给客户端。
 */

import type {ServerResponse} from 'http'
import type {CommandFailure, CommandResponse} from './types'

/** 失败结果中的结构化错误体(CommandFailure['error'] 的别名) */
export type AgentErrorBody = CommandFailure['error']

/**
 * 浏览器侧 AgentApiError 全套错误码到 HTTP 状态的映射
 * (与 packages/camera-studio/src/agent/errors.ts 的代码集保持一致):
 * - 场景/会话不可用 → 503
 * - 各类 NOT_FOUND → 404
 * - 参数类错误 → 422(传输层 JSON 语法错误用 400,见 BridgeHttpError)
 * - revision/状态冲突 → 409
 * - 鉴权 → 401/403;超限 → 413;上游网络/资源 → 502;其余 → 500
 */
export const AGENT_ERROR_HTTP_STATUS: Readonly<Record<string, number>> = {
  API_NOT_READY: 503,
  API_DISPOSED: 503,
  SCENE_UNAVAILABLE: 503,
  COMMAND_NOT_FOUND: 404,
  CAPABILITY_UNAVAILABLE: 422,
  INVALID_ARGUMENT: 422,
  INVALID_ID_KIND: 422,
  OBJECT_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  PATH_POINT_NOT_FOUND: 404,
  KEYFRAME_NOT_FOUND: 404,
  INVALID_STATE: 409,
  REVISION_CONFLICT: 409,
  JOB_NOT_FOUND: 404,
  JOB_NOT_CANCELABLE: 409,
  JOB_CANCELLED: 409,
  FILE_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  STORAGE_ERROR: 500,
  NETWORK_ERROR: 502,
  RESOURCE_LOAD_FAILED: 502,
  PARTIAL_FAILURE: 500,
  INTERNAL_ERROR: 500,
}

/** 未登记的错误码一律按 500 处理,不向客户端暗示可分支的语义 */
export function httpStatusForErrorCode(code: string): number {
  return AGENT_ERROR_HTTP_STATUS[code] ?? 500
}

/**
 * 桥接传输层自身的错误(鉴权、路由、body 解析等),带显式 HTTP 状态。
 * 传输层 `INVALID_ARGUMENT` 用 400(JSON 语法/请求形状),领域层返回的
 * `INVALID_ARGUMENT` 按映射表为 422——两者语义不同,不共享状态码。
 */
export class BridgeHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  /** 响应写完后是否销毁底层连接(超限请求必须销毁,防止继续灌数据) */
  readonly closeConnection: boolean

  constructor(
    status: number,
    code: string,
    message: string,
    options: {retryable?: boolean; closeConnection?: boolean} = {},
  ) {
    super(message)
    this.name = 'BridgeHttpError'
    this.status = status
    this.code = code
    this.retryable = options.retryable ?? false
    this.closeConnection = options.closeConnection ?? false
  }
}

export function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', payload.length)
  res.end(payload)
}

/**
 * 通用错误 writer:只写 code/message/retryable/details,绝不返回 stack。
 * 即使调用方传入的错误对象带了额外字段(stack、cause 等)也被剥掉。
 * 状态默认按错误码映射,传输层错误可显式覆盖(如 JSON 语法错误 400)。
 */
export function writeAgentError(
  res: ServerResponse,
  error: AgentErrorBody,
  status: number = httpStatusForErrorCode(error.code),
): void {
  const body: CommandFailure = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details !== undefined ? {details: error.details} : {}),
    },
  }
  writeJson(res, status, body)
}

/** 命令结果统一出口:成功 200(可由调用方覆盖),失败按错误码映射 */
export function writeCommandResponse(
  res: ServerResponse,
  response: CommandResponse,
  successStatus = 200,
): void {
  if (response.ok) {
    writeJson(res, successStatus, response)
  } else {
    writeAgentError(res, response.error)
  }
}
