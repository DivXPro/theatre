/**
 * 浏览器桥接客户端(2026-10-19,Task 6,spec §10.2/§10.4):
 * 浏览器页面主动经 WebSocket 连接本机桥接进程,把到达的命令转给
 * AgentCommandRegistry 执行,并把任务事件回推给桥接。
 *
 * 契约要点(与 @dreamerbird/camera-studio-bridge 的 wire DTO 字段一致;
 * 浏览器包不 import Node 包,契约是线上的 JSON):
 * - subprotocol:`camera-studio-v1`(协议标识)+ `token.<encodeURIComponent(token)>`
 *   (凭据);token 绝不出现在日志/错误信息中;
 * - 每次连接生成新 sessionId;hello 携带 sessionId 与 registry.describe()
 *   的 schema;job 事件携带同一 sessionId(断连重连后桥接按新 hello
 *   重置去重作用域,旧 sessionId 的迟到事件被桥接代次闸门丢弃);
 * - command 报文:requestId 原样透传给 registry.execute;args 里的
 *   fileRef 先经 bridgeFiles 水合(失败结构化上抛,不调用领域命令);
 *   成功回 result 报文——项目 mutation(stateDomain=project 且
 *   kind=mutation)携带执行后的 runtime.revision,query/资产/会话命令不带;
 *   AgentApiError 与未知异常一律回结构化 error 报文,绝不因错误关闭 socket;
 * - job 事件:succeeded 且结果带 Blob 的先 dehydrate(上传桥接换
 *   {fileId,...});上传失败投影为 failed NETWORK_ERROR;
 * - cancel 报文转发 runtime.jobs.cancel(桥接当前走 jobs.cancel 命令,
 *   这里防御性兼容);连接级 error 报文(单场景拒绝)只告警不崩溃;
 * - 重连:指数退避(250ms 起步倍增,上限 5 秒),只针对临时断线;
 *   close() 后停止重连、退订任务、摘除 socket 处理器、拒绝新执行。
 *
 * 只使用浏览器原生 WebSocket/fetch,不引入 ws/fs/Node http 依赖。
 */
import {AgentApiError, asAgentApiError} from './errors'
import type {AgentCommandRegistry} from './registry'
import type {CommandDescription} from './registry'
import type {AgentRuntime} from './runtime'
import type {JobSnapshot} from './types'
import {hydrateCommandArgs, dehydrateJobResult} from './bridgeFiles'
import type {BridgeFileTransport} from './bridgeFiles'
import type {CameraStudioAgentBridgeConfig} from '../config'

// ── wire 镜像(字段名与 camera-studio-bridge/src/types.ts 一字不差) ──

/** 命令请求(HTTP POST /v1/commands 请求体,也是 command 报文载荷) */
export type BridgeCommandRequest = {
  requestId: string
  name: string
  args: unknown
}

export type BridgeCommandSuccess = {
  ok: true
  result: unknown
  revision?: number
}

export type BridgeCommandFailure = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    details?: unknown
  }
}

/** 页面 ↔ 桥接的内部 WebSocket 报文(浏览器侧镜像) */
export type BridgeWireMessage =
  | {type: 'hello'; sessionId: string; schema: unknown}
  | {type: 'command'; commandId: string; request: BridgeCommandRequest}
  | {type: 'result'; commandId: string; response: BridgeCommandSuccess}
  | {type: 'job'; sessionId: string; snapshot: JobSnapshot<unknown>}
  | {type: 'cancel'; jobId: string}
  | {type: 'error'; commandId: string; response: BridgeCommandFailure}

export type AgentBridgeClientDeps = {
  /** 会话级注册表(bootstrap 以会话 runtime 构造,与门面同一命令集) */
  registry: AgentCommandRegistry
  /** 会话 runtime:revision 读取与 jobs 事件源 */
  runtime: AgentRuntime
  config: CameraStudioAgentBridgeConfig
}

export type AgentBridgeClient = {
  /** 关闭连接、停止重连、退订任务;之后拒绝新执行。幂等 */
  close(): void
}

/** WebSocket 协议标识(不是凭据;凭据在 token.<encoded> 里) */
const WS_PROTOCOL = 'camera-studio-v1'
/** readyState === 1(OPEN);不依赖构造器上的静态常量,fake 替身也适用 */
const WS_OPEN = 1
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 5000

let sessionFallbackCounter = 0

/** sessionId:优先 crypto.randomUUID;缺失时回退进程内计数器(同 jobs/api 模式) */
function newSessionId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  sessionFallbackCounter += 1
  return `session-${Date.now()}-${sessionFallbackCounter}`
}

export function createAgentBridgeClient(
  deps: AgentBridgeClientDeps,
): AgentBridgeClient {
  const {registry, runtime, config} = deps
  const transport: BridgeFileTransport = {
    httpUrl: config.httpUrl,
    token: config.token,
  }

  let socket: WebSocket | undefined
  let sessionId: string | undefined
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempts = 0
  /** 命令元数据缓存(hello 时建立):判定项目 mutation 是否带 revision */
  let commandMeta: Map<string, CommandDescription> | undefined

  function getCommandMeta(name: string): CommandDescription | undefined {
    if (commandMeta === undefined) {
      commandMeta = new Map()
      for (const command of registry.describe().commands) {
        commandMeta.set(command.name, command)
      }
    }
    return commandMeta.get(name)
  }

  /** 发送(仅当连接打开);未连接/已关闭静默丢弃——桥接侧断连已做失败投影 */
  function send(message: BridgeWireMessage): void {
    const ws = socket
    if (ws === undefined || ws.readyState !== WS_OPEN) return
    ws.send(JSON.stringify(message))
  }

  function handleCommand(commandId: unknown, request: unknown): void {
    if (typeof commandId !== 'string' || commandId === '') return
    if (typeof request !== 'object' || request === null) return
    const {requestId, name, args} = request as BridgeCommandRequest
    if (typeof name !== 'string' || name === '') return
    void executeCommand(commandId, {
      requestId: typeof requestId === 'string' ? requestId : '',
      name,
      args,
    })
  }

  async function executeCommand(
    commandId: string,
    request: BridgeCommandRequest,
  ): Promise<void> {
    try {
      // close 后拒绝新执行(消息处理器已摘除,这里是迟到/竞态兜底)
      if (closed) {
        throw new AgentApiError('API_DISPOSED', '桥接客户端已关闭')
      }
      // 二进制水合在领域命令之前:失败结构化上抛,不调用 registry
      const hydrated = await hydrateCommandArgs(request.args, transport)
      const result = await registry.execute(request.name, hydrated, {
        // requestId 原样透传(桥接去重依赖;spec 8.5)
        requestId: request.requestId,
        signal: new AbortController().signal,
      })
      const response: BridgeCommandSuccess = {ok: true, result}
      // 项目 mutation 携带执行后的当前 revision(命令内部已等过
      // nextRevision 的 core tick,此刻 runtime.revision 反映本次写入)
      const meta = getCommandMeta(request.name)
      if (meta?.stateDomain === 'project' && meta.kind === 'mutation') {
        response.revision = runtime.revision
      }
      send({type: 'result', commandId, response})
    } catch (error) {
      // 错误绝不关闭 socket:统一归一为结构化 error 报文
      const apiError = asAgentApiError(error)
      const response: BridgeCommandFailure = {
        ok: false,
        error: {
          code: apiError.code,
          message: apiError.message,
          retryable: apiError.retryable,
          ...(apiError.details !== undefined
            ? {details: apiError.details}
            : {}),
        },
      }
      send({type: 'error', commandId, response})
    }
  }

  /** 任务事件投影:Blob 结果先上传换 fileId;异步完成后只往当前连接发 */
  async function projectJob(
    ws: WebSocket,
    sid: string,
    snapshot: JobSnapshot<unknown>,
  ): Promise<void> {
    let projected: JobSnapshot<unknown>
    try {
      projected = await dehydrateJobResult(snapshot, transport)
    } catch (error) {
      // dehydrate 内部已兜底(failed NETWORK_ERROR);这里是意外异常
      const normalized = asAgentApiError(error)
      projected = {
        ...snapshot,
        state: 'failed',
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
      }
      delete projected.result
    }
    if (closed || socket !== ws || sessionId !== sid) return
    if (ws.readyState !== WS_OPEN) return
    ws.send(JSON.stringify({type: 'job', sessionId: sid, snapshot: projected}))
  }

  const unsubscribeJobs = runtime.jobs.subscribe((snapshot) => {
    const ws = socket
    const sid = sessionId
    // 未连接时丢弃:桥接在断连时已把非终态任务投影为 failed
    if (ws === undefined || sid === undefined || ws.readyState !== WS_OPEN) {
      return
    }
    void projectJob(ws, sid, snapshot)
  })

  function handleMessage(data: unknown): void {
    if (typeof data !== 'string') return
    let message: BridgeWireMessage
    try {
      message = JSON.parse(data) as BridgeWireMessage
    } catch {
      return
    }
    switch (message.type) {
      case 'command':
        handleCommand(message.commandId, message.request)
        break
      case 'cancel':
        // 桥接当前经 jobs.cancel 命令转发取消(JobStore);防御性兼容
        // cancel 报文形态,失败(未知/不可取消/已结束)静默
        try {
          runtime.jobs.cancel(message.jobId)
        } catch {
          /* 取消失败不改变任务终态权威(浏览器 job 事件) */
        }
        break
      case 'error':
        // 连接级错误(如桥接只接受一个活动场景会话):告警但不关闭、
        // 不影响重连——对端断开后本端退避重连可接管
        if (message.commandId === 'connection') {
          console.warn(
            '[camera-studio] 桥接拒绝了场景连接:' +
              (message.response?.error?.message ?? '未知原因'),
          )
        }
        break
      default:
        break
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer !== undefined) return
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
    )
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, delay)
  }

  function connect(): void {
    if (closed) return
    const WebSocketImpl = globalThis.WebSocket
    if (typeof WebSocketImpl !== 'function') {
      // 非浏览器环境(SSR/测试未注入):静默降级,不连接
      return
    }
    const ws = new WebSocketImpl(config.url, [
      WS_PROTOCOL,
      `token.${encodeURIComponent(config.token)}`,
    ])
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      reconnectAttempts = 0
      // 每次连接生成新 sessionId;hello 声明会话与 schema
      sessionId = newSessionId()
      const schema = registry.describe()
      commandMeta = new Map(schema.commands.map((c) => [c.name, c]))
      send({type: 'hello', sessionId, schema})
    }
    ws.onmessage = (event) => {
      if (socket !== ws) return
      handleMessage(event.data)
    }
    ws.onclose = () => {
      if (socket !== ws) return
      socket = undefined
      sessionId = undefined
      // 临时断线:指数退避重连(上限 5 秒);close() 后不再走到这里
      scheduleReconnect()
    }
    ws.onerror = () => {
      // 错误事件后 close 随之而来,重连统一在 onclose 处理
    }
  }

  connect()

  return {
    close(): void {
      if (closed) return
      closed = true
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      unsubscribeJobs()
      const ws = socket
      socket = undefined
      sessionId = undefined
      if (ws !== undefined) {
        // 先摘处理器再 close:onclose 不再触发重连,迟到报文不再执行
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        try {
          ws.close()
        } catch {
          /* 关闭中的 socket 抛错忽略 */
        }
      }
    },
  }
}
