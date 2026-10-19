/**
 * camera-studio HTTP 桥接的传输 DTO(2026-10-17,spec 第 8、10 节)。
 *
 * 这些类型是桥接进程与浏览器页面之间 WebSocket 报文、以及桥接对外
 * HTTP 结果的 wire 形状。任务状态/阶段与浏览器侧
 * `packages/camera-studio/src/agent/types.ts` 的 JobState /
 * CompletionPhase 保持一致;二进制结果在浏览器侧已转换为 fileId,
 * WebSocket 永不携带二进制字节。
 */

/** HTTP `POST /v1/commands` 请求体,也作为 WebSocket command 报文载荷 */
export type CommandRequest = {
  requestId: string
  name: string
  args: unknown
}

/** 命令成功结果;`revision` 只在涉及持久项目状态时返回 */
export type CommandSuccess<T = unknown> = {
  ok: true
  result: T
  revision?: number
}

/**
 * 命令失败结果;`error` 镜像浏览器侧 AgentApiError 的 DTO 形状
 * (code/message/retryable/details?),桥接原样透传。
 */
export type CommandFailure = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    details?: unknown
  }
}

export type CommandResponse<T = unknown> = CommandSuccess<T> | CommandFailure

/**
 * 任务快照(浏览器 JobSnapshot 的 wire 版本)。
 * state: pending | running | succeeded | failed | cancelled;
 * phase: accepted | committed | mounted | loaded。
 */
export type BridgeJobSnapshot<T = unknown> = {
  jobId: string
  kind: string
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  phase: 'accepted' | 'committed' | 'mounted' | 'loaded'
  result?: T
  error?: CommandFailure['error']
  cancelable: boolean
}

/** 鉴权配置:静态 Bearer token 和/或宿主自定义校验回调 */
export type BridgeAuth = {
  token?: string
  authenticate?: (
    request: import('http').IncomingMessage,
  ) => boolean | Promise<boolean>
}

/** 桥接启动配置(程序化入口);环境变量入口见 config.ts */
export type CameraStudioBridgeConfig = Partial<{
  host: string
  port: number
  corsOrigins: string[]
  maxUploadBytes: number
  maxCommandBytes: number
  fileTtlMs: number
}> &
  BridgeAuth

/**
 * 浏览器页面与桥接进程之间的内部 WebSocket 报文(discriminated union)。
 * 页面主动连接桥接:`hello` 声明会话与 schema;`command`/`result`/`error`
 * 承载命令往返;`job` 推送任务进度;`cancel` 由桥接转发取消请求。
 */
export type SceneWireMessage =
  | {type: 'hello'; sessionId: string; schema: unknown}
  | {type: 'command'; commandId: string; request: CommandRequest}
  | {type: 'result'; commandId: string; response: CommandSuccess}
  | {type: 'job'; sessionId: string; snapshot: BridgeJobSnapshot}
  | {type: 'cancel'; jobId: string}
  | {type: 'error'; commandId: string; response: CommandFailure}
