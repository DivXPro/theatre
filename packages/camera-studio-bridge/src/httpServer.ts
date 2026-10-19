/**
 * 桥接 HTTP 表面(spec 第 10 节):鉴权、CORS、路由和统一错误出口。
 *
 * 本模块只做传输层:
 * - `GET /v1/health` / `GET /v1/schema`;
 * - `POST /v1/commands` 的 body 解析、形状校验和结果透传;命令经
 *   `session.execute` 转发到浏览器场景(requestId 去重与 WebSocket
 *   转发在 ./SceneSession 与 ./RequestDeduplicator,Task 4);
 * - `POST /v1/files` / `GET /v1/files/:id` 的有界二进制传输(Task 3,
 *   FileStore 负责磁盘与过期,这里只做 header 适配与流转发);
 * - `GET /v1/jobs/:id` / `POST /v1/jobs/:id/cancel` 的任务投影
 *   (Task 5,JobStore 负责状态机,这里只做路由与 202/404/409 适配);
 *   job 命令(经 schema kind 判定)返回 {jobId} 后立即保存 accepted
 *   快照并应答 202,紧随其后的 GET 不会 JOB_NOT_FOUND(preflight ruling)。
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
import {authorizeRequest} from './auth'
import type {ResolvedBridgeConfig} from './config'
import {
  BridgeHttpError,
  writeAgentError,
  writeCommandResponse,
  writeJson,
} from './errors'
import type {FileStore} from './FileStore'
import type {BridgeJobSnapshot, CommandRequest, CommandResponse} from './types'

/** 场景连接状态(`GET /v1/health` 的 result 片段) */
export type SceneHealth = {
  scene: 'connected' | 'unavailable'
  sessionId?: string
}

/**
 * 场景会话依赖形状。真实实现是 ./SceneSession 的 createSceneSession
 * (Task 4):`attachUpgrade` 处理 WebSocket upgrade,`execute` 经
 * requestId 去重后转发命令到浏览器。
 */
export type BridgeSessionHandle = {
  health(): SceneHealth
  /** 已缓存的场景 schema;无场景时返回 undefined/null → 503 */
  schema(): unknown
  execute(request: CommandRequest): Promise<CommandResponse>
  attachUpgrade?(req: IncomingMessage, socket: Duplex, head: Buffer): void
}

/**
 * Task 3 的文件传输依赖:真实实现是 ./FileStore 的 createFileStore。
 * 未注入时 /v1/files 路由按未知路由 404 处理。
 */
export type {FileDescriptor, FileStore} from './FileStore'

/** Task 5 的任务投影依赖形状(真实实现是 ./JobStore 的 createJobStore) */
export type BridgeJobsHandle = {
  get(jobId: string): BridgeJobSnapshot | undefined
  cancel(jobId: string): Promise<BridgeJobSnapshot>
  /** 保存/更新任务快照;httpServer 用它写入 job 命令的 accepted 初始快照 */
  upsert(snapshot: BridgeJobSnapshot): void
}

export type HttpServerDeps = {
  config: ResolvedBridgeConfig
  session: BridgeSessionHandle
  files?: FileStore
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
 * 未知路由(含未注入依赖的 /v1/files、/v1/jobs);NOT_FOUND 是传输层
 * 代码,不在领域错误码表内,状态显式给出
 */
function notFound(): BridgeHttpError {
  return new BridgeHttpError(404, 'NOT_FOUND', '未知路由')
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

/**
 * 从 hello 携带的 schema 判断命令是否为 job,并取 cancelable 元数据。
 * schema 不可信(对端是浏览器):逐层收窄,形状不符一律按非 job 处理。
 */
function jobCommandMeta(
  schema: unknown,
  name: string,
): {cancelable: boolean} | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const commands = (schema as {commands?: unknown}).commands
  if (!Array.isArray(commands)) return undefined
  for (const entry of commands) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as {
      name?: unknown
      kind?: unknown
      cancelable?: unknown
    }
    if (candidate.name !== name) continue
    if (candidate.kind !== 'job') return undefined
    return {cancelable: candidate.cancelable === true}
  }
  return undefined
}

/**
 * job 命令的 202 投影(spec 8.7、10.1):schema kind === 'job' 的命令成功
 * 返回 {jobId} 时构造 accepted 初始快照;mutation 即使结果形似 {jobId}
 * 也不投影(由 kind 判定,不看结果形状)。
 */
function projectAcceptedJob(
  schema: unknown,
  command: CommandRequest,
  response: CommandResponse,
): BridgeJobSnapshot | undefined {
  if (!response.ok) return undefined
  const meta = jobCommandMeta(schema, command.name)
  if (meta === undefined) return undefined
  const result = response.result
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return undefined
  }
  const jobId = (result as {jobId?: unknown}).jobId
  if (typeof jobId !== 'string' || jobId === '') return undefined
  return {
    jobId,
    kind: command.name,
    state: 'pending',
    progress: 0,
    phase: 'accepted',
    cancelable: meta.cancelable,
  }
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
  const {config, session, files, jobs} = deps

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
    // job 命令:立即保存 accepted 快照并应答 202(preflight ruling:
    // 202 后紧随的 GET 不得 JOB_NOT_FOUND)
    if (jobs !== undefined) {
      const snapshot = projectAcceptedJob(session.schema(), command, response)
      if (snapshot !== undefined) {
        jobs.upsert(snapshot)
        writeJson(res, 202, {ok: true, result: snapshot})
        return
      }
    }
    writeCommandResponse(res, response)
  }

  /**
   * 上传:不解析 multipart,body 即原始字节;文件名来自
   * `X-File-Name`(encodeURIComponent 编码,保留中文名),MIME 来自
   * Content-Type 或 application/octet-stream。大小上限与部分文件
   * 清理由 FileStore 负责;超限抛 413 BridgeHttpError 由外层统一应答。
   */
  async function handleFileUpload(req: IncomingMessage, res: ServerResponse) {
    if (files === undefined) throw notFound()
    const rawName = req.headers['x-file-name']
    let fileName = ''
    if (typeof rawName === 'string' && rawName !== '') {
      try {
        fileName = decodeURIComponent(rawName)
      } catch {
        throw new BridgeHttpError(
          400,
          'INVALID_ARGUMENT',
          'X-File-Name 不是合法的百分号编码',
        )
      }
    }
    const contentType = req.headers['content-type']
    const mimeType =
      typeof contentType === 'string' && contentType !== ''
        ? contentType
        : 'application/octet-stream'
    const descriptor = await files.put({stream: req, fileName, mimeType})
    writeJson(res, 201, {ok: true, result: descriptor})
  }

  /**
   * 下载:fileId 是 `/v1/files/` 之后的整段(URL 不解码 %2F,编码斜线
   * 只按单个 fileId 处理);存在/过期判定与磁盘路径安全在 FileStore。
   * 响应头:Content-Type / Content-Length /
   * `Content-Disposition: attachment; filename*=UTF-8''<encoded>`。
   */
  function handleFileDownload(fileId: string, res: ServerResponse): void {
    if (files === undefined) throw notFound()
    const descriptor = files.get(fileId)
    const stream = files.openReadStream(fileId)
    res.statusCode = 200
    res.setHeader('Content-Type', descriptor.mimeType)
    res.setHeader('Content-Length', descriptor.size)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(descriptor.fileName)}`,
    )
    // 读流在响应后出错(如磁盘故障)只能断开,无法改状态码
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  /**
   * 任务查询:jobId 是 `/v1/jobs/` 之后的整段(与 files 同一约定)。
   * 未知任务 404 JOB_NOT_FOUND;快照原样返回(含 result/error)。
   */
  function handleJobGet(jobId: string, res: ServerResponse): void {
    if (jobs === undefined || jobId === '') throw notFound()
    const snapshot = jobs.get(jobId)
    if (snapshot === undefined) {
      throw new BridgeHttpError(404, 'JOB_NOT_FOUND', '任务不存在')
    }
    writeJson(res, 200, {ok: true, result: snapshot})
  }

  /**
   * 任务取消:成功一律 202 返回当前快照——HTTP 不假装已取消,终态以
   * 浏览器 job 事件为准。未知任务 404、不可取消 409 由 JobStore 抛出。
   */
  async function handleJobCancel(
    jobId: string,
    res: ServerResponse,
  ): Promise<void> {
    if (jobs === undefined || jobId === '') throw notFound()
    const snapshot = await jobs.cancel(jobId)
    writeJson(res, 202, {ok: true, result: snapshot})
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
    if (req.method === 'POST' && pathname === '/v1/files') {
      await handleFileUpload(req, res)
      return
    }
    if (req.method === 'GET' && pathname.startsWith('/v1/files/')) {
      handleFileDownload(pathname.slice('/v1/files/'.length), res)
      return
    }
    if (
      req.method === 'POST' &&
      pathname.startsWith('/v1/jobs/') &&
      pathname.endsWith('/cancel')
    ) {
      await handleJobCancel(
        pathname.slice('/v1/jobs/'.length, -'/cancel'.length),
        res,
      )
      return
    }
    if (req.method === 'GET' && pathname.startsWith('/v1/jobs/')) {
      handleJobGet(pathname.slice('/v1/jobs/'.length), res)
      return
    }

    // 未知路由
    throw notFound()
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

  // WebSocket upgrade 与 /v1 共用同一鉴权函数(upgrade 凭据在 subprotocol
  // 中解析,见 auth.ts);session 缺 attachUpgrade 时授权后也拒绝
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
