/**
 * Task 4 Step 1/2:WebSocket 鉴权、单场景、命令转发与断连。
 *
 * 测试用真实 http.Server + 真实 ws 客户端(127.0.0.1:0):
 * - upgrade 凭据来自 subprotocol(`camera-studio-v1` + `token.<encoded>`),
 *   无/错 token 一律拒绝;
 * - 单场景:第二个活动连接收 INVALID_STATE 后被关闭,第一连接不受影响;
 * - 命令转发:HTTP POST → wire command 同名同 args;浏览器 result → HTTP 200;
 * - 页面断连:pending HTTP 立即 503 SCENE_UNAVAILABLE,不等超时;
 * - 未知 commandId 的 result 不创建新请求也不崩溃。
 */
import http from 'http'
import type {AddressInfo} from 'net'
import {WebSocket} from 'ws'
import {BRIDGE_WS_PROTOCOL} from './auth'
import {resolveBridgeConfig, type ResolvedBridgeConfig} from './config'
import {createHttpServer} from './httpServer'
import {createSceneSession, type SceneSession} from './SceneSession'
import type {SceneWireMessage} from './types'

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'test-bridge-token'

const SCHEMA = {
  apiVersion: 1,
  commands: [
    {name: 'scene.getSnapshot', kind: 'query'},
    {name: 'models.create', kind: 'mutation'},
    {name: 'exports.startVideo', kind: 'job'},
  ],
}

type WireCommand = Extract<SceneWireMessage, {type: 'command'}>

/** fake 浏览器页面:记录收到的 wire 报文,支持按谓词等待 */
type FakeBrowser = {
  ws: WebSocket
  /** 构造时即挂 close 监听,绝不漏事件;resolve 值为 close code */
  closed: Promise<number>
  messages: SceneWireMessage[]
  commands(): WireCommand[]
  send(message: SceneWireMessage): void
  waitFor(
    pred: (message: SceneWireMessage) => boolean,
    timeoutMs?: number,
  ): Promise<SceneWireMessage>
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!()
  }
})

type StartedBridge = {
  server: http.Server
  session: SceneSession
  baseUrl: string
  wsUrl: string
}

async function startBridge(
  options: {
    config?: ResolvedBridgeConfig
  } = {},
): Promise<StartedBridge> {
  const config = options.config ?? resolveBridgeConfig({token: TOKEN})
  const session = createSceneSession()
  const server = createHttpServer({config, session})
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const {port} = server.address() as AddressInfo
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
    () => session.close(),
  )
  return {
    server,
    session,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
  }
}

function protocols(token: string | undefined): string[] {
  return token === undefined
    ? [BRIDGE_WS_PROTOCOL]
    : [BRIDGE_WS_PROTOCOL, `token.${encodeURIComponent(token)}`]
}

/** 连接成功(resolve 于 open);鉴权/协议失败走 expectUpgradeStatus */
function connectBrowser(
  wsUrl: string,
  token: string | undefined,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, protocols(token))
    cleanups.push(() => ws.terminate())
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/**
 * 连接并立即挂 fake 浏览器:拒绝报文可能和握手响应同一片段到达,
 * message 事件与 open 在同一同步流程内触发,必须在构造时就挂好
 * 记录器,不能等 open 之后再挂。
 */
async function connectFakeBrowser(
  wsUrl: string,
  token: string | undefined,
): Promise<FakeBrowser> {
  const ws = new WebSocket(wsUrl, protocols(token))
  cleanups.push(() => ws.terminate())
  const browser = createFakeBrowser(ws)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  return browser
}

/** upgrade 被拒绝时客户端收到非 101 响应;返回 HTTP 状态码 */
function expectUpgradeStatus(
  wsUrl: string,
  offered: string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, offered)
    cleanups.push(() => ws.terminate())
    ws.on('open', () => reject(new Error('upgrade unexpectedly accepted')))
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('error', () => resolve(-1))
  })
}

function createFakeBrowser(ws: WebSocket): FakeBrowser {
  const messages: SceneWireMessage[] = []
  const waiters: Array<{
    pred: (message: SceneWireMessage) => boolean
    resolve: (message: SceneWireMessage) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = []
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as SceneWireMessage
    messages.push(message)
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]
      if (waiter.pred(message)) {
        clearTimeout(waiter.timer)
        waiters.splice(i, 1)
        waiter.resolve(message)
      }
    }
  })
  const closed = new Promise<number>((resolve) => {
    ws.on('close', (code) => resolve(code))
  })
  return {
    ws,
    closed,
    messages,
    commands() {
      return messages.filter((m): m is WireCommand => m.type === 'command')
    },
    send(message: SceneWireMessage) {
      ws.send(JSON.stringify(message))
    },
    waitFor(pred, timeoutMs = 2000) {
      const existing = messages.find(pred)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for wire message')),
          timeoutMs,
        )
        waiters.push({pred, resolve, reject, timer})
      })
    },
  }
}

/** 连接 + hello,并等到 health 报告 connected(hello 处理是异步的) */
async function connectScene(bridge: StartedBridge): Promise<FakeBrowser> {
  const browser = await connectFakeBrowser(bridge.wsUrl, TOKEN)
  browser.send({type: 'hello', sessionId: 'session-1', schema: SCHEMA})
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await request(bridge.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    if (res.json().result.scene === 'connected') return browser
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('scene did not become connected after hello')
}

type HttpResult = {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
  json: () => any
}

function request(
  baseUrl: string,
  options: {
    method?: string
    path: string
    headers?: Record<string, string>
    body?: string | Buffer
  },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, baseUrl)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
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

function authedHeaders(extra: Record<string, string> = {}) {
  return {Authorization: `Bearer ${TOKEN}`, ...extra}
}

function postCommand(body: string) {
  return {
    method: 'POST',
    path: '/v1/commands',
    headers: authedHeaders({'Content-Type': 'application/json'}),
    body,
  } as const
}

describe('websocket authentication', () => {
  test('rejects upgrade without a token subprotocol', async () => {
    const {wsUrl} = await startBridge()
    expect(await expectUpgradeStatus(wsUrl, [BRIDGE_WS_PROTOCOL])).toBe(401)
  })

  test('rejects upgrade with a wrong token subprotocol', async () => {
    const {wsUrl} = await startBridge()
    expect(await expectUpgradeStatus(wsUrl, protocols('wrong-token'))).toBe(401)
  })

  test('rejects upgrade when camera-studio-v1 is not offered', async () => {
    const {wsUrl} = await startBridge()
    // 凭据正确但缺协议标识:handleProtocols 只选 camera-studio-v1 → 服务端
    // 中止握手。ws 中止时写完 400 立即 destroy,客户端可能看到 400
    // (unexpected-response)也可能只看到连接重置(-1),两者都算拒绝
    const status = await expectUpgradeStatus(wsUrl, [
      `token.${encodeURIComponent(TOKEN)}`,
    ])
    expect([400, -1]).toContain(status)
  })

  test('accepts camera-studio-v1 plus the correct token subprotocol', async () => {
    const bridge = await startBridge()
    const ws = await connectBrowser(bridge.wsUrl, TOKEN)
    expect(ws.protocol).toBe(BRIDGE_WS_PROTOCOL)
  })
})

describe('websocket origin enforcement', () => {
  /**
   * 带 Origin 头的连接/拒绝探针:ws 客户端默认不带 Origin(浏览器 WebSocket
   * 总是带),headers 里传 undefined 等价于完全不发该头
   */
  function connectBrowserWithOrigin(
    wsUrl: string,
    origin: string | undefined,
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, protocols(TOKEN), {
        headers: origin === undefined ? {} : {origin},
      })
      cleanups.push(() => ws.terminate())
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  function expectUpgradeStatusWithOrigin(
    wsUrl: string,
    origin: string | undefined,
  ): Promise<number> {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, protocols(TOKEN), {
        headers: origin === undefined ? {} : {origin},
      })
      cleanups.push(() => ws.terminate())
      ws.on('open', () => resolve(101))
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('error', () => resolve(-1))
    })
  }

  const WHITELISTED = 'http://localhost:5199'
  const whitelistedConfig = () =>
    resolveBridgeConfig({token: TOKEN, corsOrigins: [WHITELISTED]})

  test('allows any origin when corsOrigins is empty (default)', async () => {
    const bridge = await startBridge()
    const ws = await connectBrowserWithOrigin(
      bridge.wsUrl,
      'http://anywhere.example',
    )
    expect(ws.protocol).toBe(BRIDGE_WS_PROTOCOL)
  })

  test('allows an upgrade whose origin matches the whitelist', async () => {
    const bridge = await startBridge({config: whitelistedConfig()})
    const ws = await connectBrowserWithOrigin(bridge.wsUrl, WHITELISTED)
    expect(ws.protocol).toBe(BRIDGE_WS_PROTOCOL)
  })

  test('rejects an upgrade whose origin is not whitelisted', async () => {
    const bridge = await startBridge({config: whitelistedConfig()})
    expect(
      await expectUpgradeStatusWithOrigin(bridge.wsUrl, 'http://evil.example'),
    ).toBe(403)
  })

  test('rejects an upgrade without an Origin header when the whitelist is non-empty', async () => {
    const bridge = await startBridge({config: whitelistedConfig()})
    expect(await expectUpgradeStatusWithOrigin(bridge.wsUrl, undefined)).toBe(
      403,
    )
  })
})

describe('single scene session', () => {
  test('health/schema become available only after hello', async () => {
    const bridge = await startBridge()
    const ws = await connectBrowser(bridge.wsUrl, TOKEN)
    const browser = createFakeBrowser(ws)
    // 连接已建立但 hello 未发:场景仍不可用
    const before = await request(bridge.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(before.json().result.scene).toBe('unavailable')
    const schemaBefore = await request(bridge.baseUrl, {
      path: '/v1/schema',
      headers: authedHeaders(),
    })
    expect(schemaBefore.status).toBe(503)

    browser.send({type: 'hello', sessionId: 'session-1', schema: SCHEMA})
    for (let attempt = 0; attempt < 50; attempt++) {
      const health = await request(bridge.baseUrl, {
        path: '/v1/health',
        headers: authedHeaders(),
      })
      if (health.json().result.scene === 'connected') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const health = await request(bridge.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(health.json()).toEqual({
      ok: true,
      result: {bridge: 'running', scene: 'connected', sessionId: 'session-1'},
    })
    const schema = await request(bridge.baseUrl, {
      path: '/v1/schema',
      headers: authedHeaders(),
    })
    expect(schema.status).toBe(200)
    expect(schema.json()).toEqual({ok: true, result: SCHEMA})
  })

  test('rejects a second active connection with INVALID_STATE; first is unaffected', async () => {
    const bridge = await startBridge()
    const first = await connectScene(bridge)

    const second = await connectFakeBrowser(bridge.wsUrl, TOKEN)
    const rejection = await second.waitFor((m) => m.type === 'error')
    expect(rejection).toEqual({
      type: 'error',
      commandId: expect.any(String),
      response: {
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: expect.any(String),
          retryable: false,
        },
      },
    })
    await second.closed

    // 第一连接不受影响,仍可执行命令
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'after-second',
          name: 'scene.getSnapshot',
          args: {},
        }),
      ),
    )
    const command = (await first.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    first.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {pong: true}},
    })
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: {pong: true}})
  })

  test('accepts a new scene after the previous page disconnects', async () => {
    const bridge = await startBridge()
    const first = await connectScene(bridge)
    first.ws.terminate()
    for (let attempt = 0; attempt < 50; attempt++) {
      const health = await request(bridge.baseUrl, {
        path: '/v1/health',
        headers: authedHeaders(),
      })
      if (health.json().result.scene === 'unavailable') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const second = await connectScene(bridge)
    expect(second.ws.readyState).toBe(WebSocket.OPEN)
  })
})

describe('command forwarding', () => {
  test('returns 503 SCENE_UNAVAILABLE when no scene is connected', async () => {
    const bridge = await startBridge()
    const res = await request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-no-scene',
          name: 'scene.getSnapshot',
          args: {},
        }),
      ),
    )
    expect(res.status).toBe(503)
    expect(res.json().error.code).toBe('SCENE_UNAVAILABLE')
    expect(res.json().error.retryable).toBe(true)
  })

  test('forwards name/args/requestId verbatim and returns the browser result', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const args = {assetId: 'a1', position: {x: 1, y: 2, z: 3}, tags: ['a', 'b']}
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({requestId: 'r-forward', name: 'models.create', args}),
      ),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    expect(command.request).toEqual({
      requestId: 'r-forward',
      name: 'models.create',
      args,
    })
    expect(typeof command.commandId).toBe('string')
    expect(command.commandId).not.toBe('')
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {modelId: 'model:a1'}, revision: 9},
    })
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      result: {modelId: 'model:a1'},
      revision: 9,
    })
  })

  test('maps browser error results to HTTP status by error code', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-error',
          name: 'models.create',
          args: {assetId: 'missing'},
        }),
      ),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'error',
      commandId: command.commandId,
      response: {
        ok: false,
        error: {
          code: 'OBJECT_NOT_FOUND',
          message: '没有该对象',
          retryable: false,
        },
      },
    })
    const res = await pending
    expect(res.status).toBe(404)
    expect(res.json()).toEqual({
      ok: false,
      error: {
        code: 'OBJECT_NOT_FOUND',
        message: '没有该对象',
        retryable: false,
      },
    })
  })

  test('fails pending commands immediately with 503 when the page disconnects', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const started = Date.now()
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-disconnect',
          name: 'models.create',
          args: {assetId: 'a1'},
        }),
      ),
    )
    await browser.waitFor((m) => m.type === 'command')
    // 页面崩溃式断开:不等浏览器响应,pending HTTP 必须立即结束
    browser.ws.terminate()
    const res = await pending
    expect(Date.now() - started).toBeLessThan(1000)
    expect(res.status).toBe(503)
    expect(res.json().error.code).toBe('SCENE_UNAVAILABLE')
    expect(res.json().error.retryable).toBe(true)
  })

  test('ignores results with an unknown commandId without crashing', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    browser.send({
      type: 'result',
      commandId: 'unknown-command-id',
      response: {ok: true, result: {ghost: true}},
    })
    browser.send({
      type: 'error',
      commandId: 'another-unknown',
      response: {
        ok: false,
        error: {code: 'INTERNAL_ERROR', message: 'ghost', retryable: false},
      },
    })
    // 不崩溃、不创建请求:后续命令照常工作
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-after-ghost',
          name: 'scene.getSnapshot',
          args: {},
        }),
      ),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {revision: 1}},
    })
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: {revision: 1}})
  })

  test('ignores malformed wire messages', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    browser.ws.send('not json at all')
    browser.ws.send(JSON.stringify({type: 'something-invented'}))
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-malformed',
          name: 'scene.getSnapshot',
          args: {},
        }),
      ),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {}},
    })
    expect((await pending).status).toBe(200)
  })

  test('passes job command results through untouched (202 projection is Task 5)', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const pending = request(
      bridge.baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'r-job',
          name: 'exports.startVideo',
          args: {cameraId: 'camera:main'},
        }),
      ),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {jobId: 'job-1'}},
    })
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: {jobId: 'job-1'}})
  })
})
