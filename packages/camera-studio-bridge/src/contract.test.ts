/*
 * @jest-environment node
 */
/**
 * Task 7:程序化入口生命周期、CLI 与 JS/HTTP 契约一致性(spec 10.3/10.4)。
 *
 * - 生命周期:port 0 返回实际端口、health 可达、close() 幂等且清理
 *   WebSocketServer/FileStore timer、close 后新连接被拒;
 * - 契约一致性:真实 AgentCommandRegistry 注册一组 fake 领域命令,
 *   真实浏览器 bridgeClient(ws 包的 WebSocket 注入 globalThis)经真实
 *   WebSocket 连到真实 Node 桥接;同一命令分别 registry.execute 直呼与
 *   HTTP POST /v1/commands,断言 result/revision/error.code 一致。
 *   覆盖:静态 mutation 成功(带 revision)、REVISION_CONFLICT、
 *   OBJECT_NOT_FOUND、job accepted(202 投影)、INVALID_ARGUMENT;
 * - CLI:重复 flag 解析、token 只从指定环境变量读取、打印实际 origin 与
 *   场景连接状态、输出绝不包含 token、SIGINT/SIGTERM 触发 close。
 *
 * 浏览器包模块经运行时 require 引入(非静态 import):jest-esbuild 不提升
 * mock,且本包 tsc 构建 rootDir=src,静态 import 会把浏览器源码拉进
 * 构建图(TS6059);require 调用不参与 tsc 模块解析,构建不受影响。
 */
import http from 'http'
import {WebSocket} from 'ws'
import {BRIDGE_WS_PROTOCOL} from './auth'
import type {CameraStudioBridge} from './bridge'
import {createCameraStudioBridge} from './bridge'
import type {RunningBridgeCli} from './cli'
import {DEFAULT_TOKEN_ENV, parseBridgeCliArgs, runBridgeCli} from './cli'

/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {AgentCommandRegistry} = require('../../camera-studio/src/agent/registry')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {AgentApiError} = require('../../camera-studio/src/agent/errors')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {
  createAgentBridgeClient,
} = require('../../camera-studio/src/agent/bridgeClient')
/* eslint-enable @typescript-eslint/no-var-requires */

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'contract-test-token'

// ── HTTP helper(与 SceneSession.test.ts 同一模式:agent:false,不经 undici 连接池) ──

type HttpResult = {
  status: number
  body: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => any
}

function request(
  origin: string,
  options: {
    method?: string
    path: string
    token?: string
    headers?: Record<string, string>
    body?: string | Buffer
  },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, origin)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method ?? 'GET',
        agent: false,
        headers: {
          ...(options.token !== undefined
            ? {Authorization: `Bearer ${options.token}`}
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode ?? 0,
            body,
            json: () => JSON.parse(body),
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (pred()) return
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor 超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** 等桥接 health 报告 scene connected(hello 处理是异步的) */
async function waitForScene(origin: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      const res = await request(origin, {path: '/v1/health', token: TOKEN})
      if (res.json().result.scene === 'connected') return
    } catch {
      /* 连接尚未就绪,下一轮再试 */
    }
    if (Date.now() - started > 5000) {
      throw new Error('场景未在超时前连接')
    }
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

/** 当前活动的 Timeout handle 集合(close 后不得新增残留) */
function activeTimers(): Set<object> {
  const handles = (
    process as unknown as {_getActiveHandles(): object[]}
  )._getActiveHandles()
  return new Set(
    handles.filter(
      (handle) =>
        (handle as {constructor?: {name?: string}}).constructor?.name ===
        'Timeout',
    ),
  )
}

// ── fake 领域命令(真实 AgentCommandRegistry + 最小 runtime stub,形状同 Task 6 测试) ──

type FakeRuntime = {
  revision: number
  jobs: {
    subscribe: (listener: (snapshot: unknown) => void) => () => void
    cancel: (jobId: string) => void
  }
}

function makeRuntime(): FakeRuntime {
  return {
    revision: 1,
    jobs: {
      subscribe: () => () => {},
      cancel: () => {},
    },
  }
}

const EMPTY_SCHEMA = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRegistry(runtime: FakeRuntime): any {
  const registry = new AgentCommandRegistry()
  registry.register({
    name: 'fake.setStatic',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    inputSchema: {
      type: 'object',
      properties: {value: {type: 'number'}},
      required: ['value'],
    },
    outputSchema: EMPTY_SCHEMA,
    errorCodes: ['INVALID_ARGUMENT'],
    validate: (value: unknown) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as {value?: unknown}).value !== 'number'
      ) {
        throw new AgentApiError('INVALID_ARGUMENT', 'value 必须是 number')
      }
      return value
    },
    execute: async (args: {value: number}) => {
      runtime.revision += 1
      return {applied: args.value}
    },
  })
  registry.register({
    name: 'fake.guardedUpdate',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    inputSchema: {
      type: 'object',
      properties: {expectedRevision: {type: 'number'}},
      required: ['expectedRevision'],
    },
    outputSchema: EMPTY_SCHEMA,
    errorCodes: ['REVISION_CONFLICT'],
    validate: (value: unknown) => value as {expectedRevision: number},
    execute: async (args: {expectedRevision: number}) => {
      if (args.expectedRevision !== runtime.revision) {
        throw new AgentApiError('REVISION_CONFLICT', 'revision 冲突', {
          details: {
            expectedRevision: args.expectedRevision,
            actualRevision: runtime.revision,
          },
        })
      }
      runtime.revision += 1
      return {applied: true}
    },
  })
  registry.register({
    name: 'fake.getObject',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {type: 'object'},
    outputSchema: EMPTY_SCHEMA,
    errorCodes: ['OBJECT_NOT_FOUND'],
    validate: (value: unknown) => value,
    execute: async (args: {objectId?: string}) => {
      if (args?.objectId !== 'model:exists') {
        throw new AgentApiError(
          'OBJECT_NOT_FOUND',
          `对象不存在: ${String(args?.objectId)}`,
        )
      }
      return {objectId: 'model:exists'}
    },
  })
  registry.register({
    name: 'fake.startExport',
    kind: 'job',
    stateDomain: 'asset',
    undoable: 'none',
    cancelable: true,
    inputSchema: {type: 'object'},
    outputSchema: {type: 'object'},
    errorCodes: [],
    validate: (value: unknown) => value,
    execute: async () => ({jobId: 'job-contract-1'}),
  })
  return registry
}

// ── 直呼(JS)与 HTTP 两侧执行 helper ──

type DirectOutcome =
  | {ok: true; result: unknown; revision: number}
  | {ok: false; code: string; details?: unknown}

let requestCounter = 0

async function directExecute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry: any,
  runtime: FakeRuntime,
  name: string,
  args: unknown,
): Promise<DirectOutcome> {
  requestCounter += 1
  try {
    const result = await registry.execute(name, args, {
      requestId: `direct-${requestCounter}`,
      signal: new AbortController().signal,
    })
    return {ok: true, result, revision: runtime.revision}
  } catch (error) {
    const apiError = error as {code?: unknown; details?: unknown}
    return {ok: false, code: String(apiError.code), details: apiError.details}
  }
}

async function httpExecute(
  origin: string,
  name: string,
  args: unknown,
): Promise<{
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}> {
  requestCounter += 1
  const res = await request(origin, {
    method: 'POST',
    path: '/v1/commands',
    token: TOKEN,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({requestId: `http-${requestCounter}`, name, args}),
  })
  return {status: res.status, body: res.json()}
}

// ── 生命周期 ──

describe('createCameraStudioBridge 生命周期', () => {
  test('port 0 返回实际端口;health 可达;close 终止场景连接、拒绝新连接且幂等', async () => {
    const bridge = await createCameraStudioBridge({port: 0, token: TOKEN})
    try {
      expect(bridge.port).toBeGreaterThan(0)
      expect(bridge.origin).toBe(`http://127.0.0.1:${bridge.port}`)

      // 无凭据一律 401
      const unauthorized = await request(bridge.origin, {path: '/v1/health'})
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.json().error.code).toBe('UNAUTHORIZED')

      const health = await request(bridge.origin, {
        path: '/v1/health',
        token: TOKEN,
      })
      expect(health.status).toBe(200)
      expect(health.json()).toEqual({
        ok: true,
        result: {bridge: 'running', scene: 'unavailable'},
      })

      // 场景会话与文件传输在运行期间可用
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, [
        BRIDGE_WS_PROTOCOL,
        `token.${encodeURIComponent(TOKEN)}`,
      ])
      const wsClosed = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code))
      })
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })
      ws.send(
        JSON.stringify({
          type: 'hello',
          sessionId: 'lifecycle-session',
          schema: {apiVersion: 1, commands: []},
        }),
      )
      await waitForScene(bridge.origin)

      const upload = await request(bridge.origin, {
        method: 'POST',
        path: '/v1/files',
        token: TOKEN,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent('a.bin'),
        },
        body: Buffer.from('file-bytes'),
      })
      expect(upload.status).toBe(201)
      const fileId = upload.json().result.fileId
      const download = await request(bridge.origin, {
        path: `/v1/files/${fileId}`,
        token: TOKEN,
      })
      expect(download.status).toBe(200)
      expect(download.body).toBe('file-bytes')

      await bridge.close()
      // WebSocketServer 随 close 清理:活动场景连接被终止
      await wsClosed
      // close 后新连接失败
      await expect(
        request(bridge.origin, {path: '/v1/health', token: TOKEN}),
      ).rejects.toThrow()
      // 重复 close 幂等
      await bridge.close()
    } finally {
      await bridge.close()
    }
  })

  test('close() 不残留新 timer(FileStore sweep 等全部清理)', async () => {
    const before = activeTimers()
    const bridge = await createCameraStudioBridge({port: 0, token: TOKEN})
    await bridge.close()
    await bridge.close()
    const lingering = [...activeTimers()].filter((timer) => !before.has(timer))
    expect(lingering).toEqual([])
    await expect(
      request(bridge.origin, {path: '/v1/health', token: TOKEN}),
    ).rejects.toThrow()
  })

  test('无鉴权配置拒绝启动(spec:没有 token 或等效鉴权不得启动)', async () => {
    await expect(createCameraStudioBridge({port: 0})).rejects.toThrow(
      /authentication/i,
    )
  })
})

// ── JS/HTTP 契约一致性 ──

describe('JS/HTTP 契约一致性(真实 WebSocket:浏览器 bridgeClient ↔ Node 桥接)', () => {
  let bridge: CameraStudioBridge
  let client: {close(): void}
  let runtime: FakeRuntime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registry: any

  beforeEach(async () => {
    bridge = await createCameraStudioBridge({port: 0, token: TOKEN})
    runtime = makeRuntime()
    registry = makeRegistry(runtime)
    // jsdom 无 WebSocket;注入 ws 包的真实实现,浏览器客户端原样运行
    ;(globalThis as Record<string, unknown>).WebSocket = WebSocket
    client = createAgentBridgeClient({
      registry,
      runtime,
      config: {
        url: `ws://127.0.0.1:${bridge.port}`,
        token: TOKEN,
        httpUrl: bridge.origin,
      },
    })
    await waitForScene(bridge.origin)
  })

  afterEach(async () => {
    client.close()
    await bridge.close()
    delete (globalThis as Record<string, unknown>).WebSocket
  })

  test('GET /v1/schema 与 registry.describe() 一致', async () => {
    const res = await request(bridge.origin, {
      path: '/v1/schema',
      token: TOKEN,
    })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: registry.describe()})
  })

  test('静态 mutation 成功:result 与 revision 两侧一致', async () => {
    const before = runtime.revision
    const direct = await directExecute(registry, runtime, 'fake.setStatic', {
      value: 7,
    })
    // 直呼已推进 revision;HTTP 侧重放同一起点,保证两侧读到同一结果
    runtime.revision = before
    const viaHttp = await httpExecute(bridge.origin, 'fake.setStatic', {
      value: 7,
    })
    expect(direct).toEqual({
      ok: true,
      result: {applied: 7},
      revision: before + 1,
    })
    expect(viaHttp.status).toBe(200)
    expect(viaHttp.body).toEqual({
      ok: true,
      result: {applied: 7},
      revision: before + 1,
    })
  })

  test('REVISION_CONFLICT:error.code 与 details 两侧一致(409)', async () => {
    const args = {expectedRevision: 999}
    const direct = await directExecute(
      registry,
      runtime,
      'fake.guardedUpdate',
      args,
    )
    const viaHttp = await httpExecute(bridge.origin, 'fake.guardedUpdate', args)
    expect(direct).toEqual({
      ok: false,
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 999, actualRevision: runtime.revision},
    })
    expect(viaHttp.status).toBe(409)
    expect(viaHttp.body.ok).toBe(false)
    expect(viaHttp.body.error.code).toBe(direct.ok === false ? direct.code : '')
    expect(viaHttp.body.error.details).toEqual(
      direct.ok === false ? direct.details : undefined,
    )
  })

  test('OBJECT_NOT_FOUND:error.code 两侧一致(404)', async () => {
    const args = {objectId: 'model:missing'}
    const direct = await directExecute(
      registry,
      runtime,
      'fake.getObject',
      args,
    )
    const viaHttp = await httpExecute(bridge.origin, 'fake.getObject', args)
    expect(direct).toEqual({
      ok: false,
      code: 'OBJECT_NOT_FOUND',
      details: undefined,
    })
    expect(viaHttp.status).toBe(404)
    expect(viaHttp.body.ok).toBe(false)
    expect(viaHttp.body.error.code).toBe('OBJECT_NOT_FOUND')
    expect(viaHttp.body.error.retryable).toBe(false)
  })

  test('INVALID_ARGUMENT(validator 拒绝):error.code 两侧一致(422)', async () => {
    const args = {value: 'not-a-number'}
    const direct = await directExecute(
      registry,
      runtime,
      'fake.setStatic',
      args,
    )
    const viaHttp = await httpExecute(bridge.origin, 'fake.setStatic', args)
    expect(direct).toEqual({
      ok: false,
      code: 'INVALID_ARGUMENT',
      details: undefined,
    })
    expect(viaHttp.status).toBe(422)
    expect(viaHttp.body.ok).toBe(false)
    expect(viaHttp.body.error.code).toBe('INVALID_ARGUMENT')
  })

  test('job 命令:JS 直呼返回 {jobId};HTTP 202 立即投影 accepted 快照且可查询', async () => {
    const direct = await directExecute(
      registry,
      runtime,
      'fake.startExport',
      {},
    )
    expect(direct).toEqual({
      ok: true,
      result: {jobId: 'job-contract-1'},
      revision: runtime.revision,
    })

    const viaHttp = await httpExecute(bridge.origin, 'fake.startExport', {})
    expect(viaHttp.status).toBe(202)
    expect(viaHttp.body.ok).toBe(true)
    const snapshot = viaHttp.body.result
    // jobId 与直呼结果同源
    expect(snapshot.jobId).toBe('job-contract-1')
    expect(snapshot).toEqual({
      jobId: 'job-contract-1',
      kind: 'fake.startExport',
      state: 'pending',
      progress: 0,
      phase: 'accepted',
      cancelable: true,
    })

    // 紧随其后的 GET 不得 JOB_NOT_FOUND(preflight ruling)
    const job = await request(bridge.origin, {
      path: '/v1/jobs/job-contract-1',
      token: TOKEN,
    })
    expect(job.status).toBe(200)
    expect(job.json()).toEqual({ok: true, result: snapshot})
  })
})

// ── CLI ──

describe('camera-studio-bridge CLI', () => {
  test('参数解析:重复 --cors-origin 累积、--port 后值覆盖、--token 非法', () => {
    const options = parseBridgeCliArgs([
      '--host',
      '0.0.0.0',
      '--port',
      '1',
      '--port',
      '44000',
      '--token-env',
      'MY_TOKEN',
      '--cors-origin',
      'https://a.example',
      '--cors-origin',
      'https://b.example',
    ])
    expect(options).toEqual({
      host: '0.0.0.0',
      port: 44000,
      tokenEnv: 'MY_TOKEN',
      corsOrigins: ['https://a.example', 'https://b.example'],
      help: false,
    })
    // --flag=value 形式等价
    expect(parseBridgeCliArgs(['--port=44001']).port).toBe(44001)
    // token 绝不接受命令行直传
    expect(() => parseBridgeCliArgs(['--token', 'abc'])).toThrow(/未知参数/)
    expect(() => parseBridgeCliArgs(['--port', 'abc'])).toThrow(/--port/)
    expect(() => parseBridgeCliArgs(['--nonsense'])).toThrow(/未知参数/)
    expect(parseBridgeCliArgs([])).toMatchObject({
      tokenEnv: DEFAULT_TOKEN_ENV,
      corsOrigins: [],
      help: false,
    })
  })

  test('token 只从指定环境变量读取;缺失时报错且错误信息只含变量名', async () => {
    await expect(
      runBridgeCli(['--port', '0', '--token-env', 'MISSING_TOKEN_VAR'], {
        env: {},
        print: () => {},
      }),
    ).rejects.toThrow(/MISSING_TOKEN_VAR/)
  })

  test('打印实际 origin 与场景连接状态,输出不含 token;SIGINT/SIGTERM 关闭桥接', async () => {
    const printed: string[] = []
    const signals = new Map<string, () => void>()
    const started = await runBridgeCli(
      ['--port', '0', '--token-env', 'CONTRACT_CLI_TOKEN'],
      {
        env: {CONTRACT_CLI_TOKEN: 'cli-secret-token'},
        print: (line) => printed.push(line),
        onSignal: (signal, handler) => signals.set(signal, handler),
        healthPollMs: 25,
      },
    )
    if (started === undefined) {
      throw new Error('runBridgeCli 意外返回 undefined(--help 路径)')
    }
    const running: RunningBridgeCli = started
    try {
      expect(running.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(printed.some((line) => line.includes(running.origin))).toBe(true)
      // 初始场景状态:unavailable
      await waitFor(() => printed.some((line) => line.includes('unavailable')))

      // 连接一个场景,观察 connected 状态输出
      const port = Number(new URL(running.origin).port)
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, [
        BRIDGE_WS_PROTOCOL,
        `token.${encodeURIComponent('cli-secret-token')}`,
      ])
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })
      ws.send(
        JSON.stringify({
          type: 'hello',
          sessionId: 'cli-session',
          schema: {apiVersion: 1, commands: []},
        }),
      )
      await waitFor(() => printed.some((line) => line.includes('connected')))
      ws.terminate()

      // token 绝不出现在任何输出里
      expect(printed.join('\n')).not.toContain('cli-secret-token')

      // SIGINT/SIGTERM 都注册了关闭
      expect(signals.has('SIGINT')).toBe(true)
      expect(signals.has('SIGTERM')).toBe(true)
      signals.get('SIGINT')!()
      await running.close()
      const origin = running.origin
      await expect(
        request(origin, {path: '/v1/health', token: 'cli-secret-token'}),
      ).rejects.toThrow()
      // 重复 close 幂等
      await running.close()
    } finally {
      await running.close()
    }
  })
})
