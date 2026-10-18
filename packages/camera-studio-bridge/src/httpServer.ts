/**
 * 桥接 HTTP 表面(spec 第 10 节):鉴权、CORS、路由和统一错误出口。
 *
 * 本模块只做传输层:
 * - `GET /v1/health` / `GET /v1/schema`;
 * - `POST /v1/commands` 的 body 解析、形状校验和结果透传(requestId
 *   去重、WebSocket 转发在 Task 4 的 SceneSession/RequestDeduplicator);
 * - `/v1/files`、`/v1/jobs` 路由分别在 Task 3、Task 5 接入,此处只
 *   预留依赖接口形状。
 *
 * 约束:
 * - URL 精确匹配,不用正则执行用户输入;
 * - JSON body 按 maxCommandBytes 流式计数,超限请求响应后销毁连接;
 * - CORS 始终设 `Vary: Origin`,白名单为空不输出允许来源头,`*` 永不
 *   与 credentials 同现;
 * - 所有响应经 writeAgentError/writeJson,绝不返回 stack。
 */

import http from 'http'
import type {IncomingMessage, ServerResponse} from 'http'
import type {Duplex} from 'stream'
import type {Readable} from 'stream'
import {authorizeRequest} from './auth'
import type {ResolvedBridgeConfig} from './config'
import {
  BridgeHttpError,
  writeAgentError,
  writeCommandResponse,
  writeJson,
} from './errors'
import type {BridgeJobSnapshot, CommandRequest, CommandResponse} from './types'

/** 场景连接状态(`GET /v1/health` 的 result 片段) */
export type SceneHealth = {
  scene: 'connected' | 'unavailable'
  sessionId?: string
}

/**
 * 场景会话依赖形状。Task 4 的 SceneSession 实现真实版本:
 * `attachUpgrade` 处理 WebSocket upgrade,`execute` 转发命令到浏览器。
 * 本任务用 fake session 接线。
 */
export type BridgeSessionHandle = {
  health(): SceneHealth
  /** 已缓存的场景 schema;无场景时返回 undefined/null → 503 */
  schema(): unknown
  execute(request: CommandRequest): Promise<CommandResponse>
  attachUpgrade?(req: IncomingMessage, socket: Duplex, head: Buffer): void
}

/** Task 3 的文件传输依赖形状(FileStore);本任务不挂 /v1/files 路由 */
export type BridgeFileDescriptor = {
  fileId: string
  fileName: string
  mimeType: string
  size: number
}

export type BridgeFilesHandle = {
  put(input: {
    stream: Readable
    fileName: string
    mimeType: string
  }): Promise<BridgeFileDescriptor>
  get(fileId: string): BridgeFileDescriptor
  openReadStream(fileId: string): Readable
  delete(fileId: string): Promise<void>
  close(): Promise<void>
}

/** Task 5 的任务投影依赖形状(JobStore);本任务不挂 /v1/jobs 路由 */
export type BridgeJobsHandle = {
  get(jobId: string): BridgeJobSnapshot | undefined
  cancel(jobId: string): Promise<BridgeJobSnapshot>
}

export type HttpServerDeps = {
  config: ResolvedBridgeConfig
  session: BridgeSessionHandle
  files?: BridgeFilesHandle
  jobs?: BridgeJobsHandle
}

/**
 * CORS(spec 第 4 节:不开放宽泛 CORS):
 * - 始终设置 `Vary: Origin`;
 * - 白名单为空时不输出任何允许来源头;
 * - 命中白名单时回显该 origin(绝不回显任意 origin);
 * - `*` 放行所有来源,但永不输出 credentials 头,避免 `*` 与
 *   credentials 同现。
 */
export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedBridgeConfig,
): void {
  res.setHeader('Vary', 'Origin')
  const origin = req.headers.origin
  if (origin === undefined) return
  const allowed = config.corsOrigins
  if (allowed.length === 0) return
  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    return
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-File-Name',
  )
}

function writeUnauthorized(res: ServerResponse): void {
  res.setHeader('WWW-Authenticate', 'Bearer realm="camera-studio-bridge"')
  writeAgentError(res, {
    code: 'UNAUTHORIZED',
    message: '缺少或无效的鉴权凭据',
    retryable: false,
  })
}

/**
 * 流式读取并解析 JSON body:逐块累计字节,超过 maxCommandBytes 抛 413
 * 并标记销毁连接;JSON 语法错误抛 400(传输层 INVALID_ARGUMENT)。
 * Content-Length 预检只决定是否缓冲;超限 body 一律排空后再响应,
 * 保证 413 确定性送达(见下文注释)。
 */
async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(req.headers['content-length'])
  // Content-Length 预检只决定"是否缓冲",绝不提前响应:响应前必须排空
  // 请求体,否则 destroy 时连接上还有未读入站数据,可能把 413 响应 RST 掉
  let tooLarge = Number.isFinite(declared) && declared > maxBytes
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    if (tooLarge) continue // 排空剩余数据,让响应能干净地写回
    total += (chunk as Buffer).length
    if (total > maxBytes) {
      tooLarge = true
      continue
    }
    chunks.push(chunk as Buffer)
  }
  if (tooLarge) {
    throw new BridgeHttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `请求体超过 maxCommandBytes(${maxBytes} 字节)`,
      {closeConnection: true},
    )
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BridgeHttpError(400, 'INVALID_ARGUMENT', '请求体不是合法 JSON')
  }
}

/**
 * 只校验传输形状:requestId/name 为非空字符串且 args 键存在。
 * args 可以是任意 JSON 值,领域校验在浏览器命令 validator 完成,
 * Node 侧不复制领域 schema。
 */
function asCommandRequest(body: unknown): CommandRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BridgeHttpError(400, 'INVALID_ARGUMENT', '请求体必须是 JSON 对象')
  }
  const {requestId, name, args} = body as Record<string, unknown>
  if (typeof requestId !== 'string' || requestId === '') {
    throw new BridgeHttpError(
      400,
      'INVALID_ARGUMENT',
      'requestId 必须是非空字符串',
    )
  }
  if (typeof name !== 'string' || name === '') {
    throw new BridgeHttpError(400, 'INVALID_ARGUMENT', 'name 必须是非空字符串')
  }
  if (!('args' in (body as object))) {
    throw new BridgeHttpError(400, 'INVALID_ARGUMENT', '缺少 args 字段')
  }
  return {requestId, name, args}
}

function writeInternalError(res: ServerResponse): void {
  // 未处理异常:只返回通用信息,绝不回显异常 message/stack
  writeAgentError(res, {
    code: 'INTERNAL_ERROR',
    message: '桥接内部错误',
    retryable: false,
  })
}

export function createHttpServer(deps: HttpServerDeps): http.Server {
  const {config, session} = deps

  async function handleCommand(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, config.maxCommandBytes)
    const command = asCommandRequest(body)
    let response: CommandResponse
    try {
      response = await session.execute(command)
    } catch {
      writeInternalError(res)
      return
    }
    writeCommandResponse(res, response)
  }

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    applyCors(req, res, config)

    // 预检请求不带凭据,只按 CORS 白名单应答
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    // 所有 /v1 路由与 upgrade 共用同一鉴权函数;未通过一律 401,
    // 不区分"路由不存在"和"未授权",避免泄露路由表
    const authorized = await authorizeRequest(req, config)
    if (!authorized) {
      writeUnauthorized(res)
      return
    }

    // URL 精确匹配,不用正则执行用户输入
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'GET' && pathname === '/v1/health') {
      writeJson(res, 200, {
        ok: true,
        result: {bridge: 'running', ...session.health()},
      })
      return
    }
    if (req.method === 'GET' && pathname === '/v1/schema') {
      const schema = session.schema()
      if (schema === undefined || schema === null) {
        writeAgentError(res, {
          code: 'SCENE_UNAVAILABLE',
          message: '浏览器场景尚未连接桥接',
          retryable: true,
        })
        return
      }
      writeJson(res, 200, {ok: true, result: schema})
      return
    }
    if (req.method === 'POST' && pathname === '/v1/commands') {
      await handleCommand(req, res)
      return
    }

    // 未知路由(含 /v1/files、/v1/jobs,由各自任务接入);
    // NOT_FOUND 是传输层代码,不在领域错误码表内,状态显式给出
    writeAgentError(
      res,
      {
        code: 'NOT_FOUND',
        message: '未知路由',
        retryable: false,
      },
      404,
    )
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (error instanceof BridgeHttpError) {
        if (error.closeConnection) {
          // 超限请求体已在 readJsonBody 排空(无未读入站数据),这里用
          // Connection: close 优雅关闭:直接 destroy 会在客户端仍在发送
          // 时把还没送达的 413 响应 RST 掉(实测 socket hang up)
          res.setHeader('Connection', 'close')
        }
        writeAgentError(
          res,
          {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
          error.status,
        )
      } else {
        writeInternalError(res)
      }
    })
  })

  // WebSocket upgrade 与 /v1 共用同一鉴权函数;真实页面接入在 Task 4,
  // 未实现 attachUpgrade 前已授权的 upgrade 一律拒绝
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    authorizeRequest(req, config).then(
      (authorized) => {
        if (!authorized) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
          socket.destroy()
          return
        }
        if (session.attachUpgrade) {
          session.attachUpgrade(req, socket, head)
        } else {
          socket.write(
            'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
          )
          socket.destroy()
        }
      },
      () => socket.destroy(),
    )
  })

  return server
}
