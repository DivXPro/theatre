/**
 * Task 2:HTTP 鉴权、CORS、health/schema 与统一错误映射。
 *
 * 测试用真实 http.Server 绑 127.0.0.1:0(临时端口)发真实 HTTP 请求;
 * session 为 fake(execute/health/schema),files/jobs 接口形状预留,
 * 真实路由由后续任务接入。
 */
import http from 'http'
import type {IncomingMessage} from 'http'
import type {AddressInfo} from 'net'
import {authorizeRequest} from './auth'
import {resolveBridgeConfig, type ResolvedBridgeConfig} from './config'
import {createHttpServer} from './httpServer'
import type {CommandRequest, CommandResponse} from './types'

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'test-bridge-token'

type FakeSceneHealth = {scene: 'connected' | 'unavailable'; sessionId?: string}

function createFakeSession() {
  const state = {
    calls: [] as CommandRequest[],
    scene: 'unavailable' as 'connected' | 'unavailable',
    sessionId: undefined as string | undefined,
    schemaValue: undefined as unknown,
    nextResponse: {ok: true, result: {echo: true}} as CommandResponse,
    nextError: undefined as unknown,
    health(): FakeSceneHealth {
      return state.scene === 'connected'
        ? {scene: 'connected', sessionId: state.sessionId}
        : {scene: 'unavailable'}
    },
    schema(): unknown {
      return state.schemaValue
    },
    async execute(request: CommandRequest): Promise<CommandResponse> {
      state.calls.push(request)
      if (state.nextError !== undefined) throw state.nextError
      return state.nextResponse
    },
  }
  return state
}

type StartedServer = {
  server: http.Server
  session: ReturnType<typeof createFakeSession>
  baseUrl: string
}

const started: http.Server[] = []

async function startServer(options: {
  config?: ResolvedBridgeConfig
  session?: ReturnType<typeof createFakeSession>
}): Promise<StartedServer> {
  const config = options.config ?? resolveBridgeConfig({token: TOKEN})
  const session = options.session ?? createFakeSession()
  const server = createHttpServer({config, session})
  started.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const {port} = server.address() as AddressInfo
  return {server, session, baseUrl: `http://127.0.0.1:${port}`}
}

afterEach(async () => {
  while (started.length > 0) {
    const server = started.pop()!
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

type HttpResult = {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
  json: () => any
}

/** 真实 HTTP 请求(node:http),不依赖 jest 环境是否暴露 fetch */
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

describe('authentication', () => {
  test('rejects requests without credentials and never reaches the session', async () => {
    const {baseUrl, session} = await startServer({})
    const res = await request(baseUrl, {
      method: 'POST',
      path: '/v1/commands',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        requestId: 'r1',
        name: 'scene.getSnapshot',
        args: {},
      }),
    })
    expect(res.status).toBe(401)
    expect(res.json()).toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String),
        retryable: false,
      },
    })
    expect(res.headers['www-authenticate']).toMatch(/Bearer/i)
    expect(session.calls).toEqual([])
  })

  test('rejects a wrong bearer token', async () => {
    const {baseUrl, session} = await startServer({})
    const res = await request(baseUrl, {
      method: 'POST',
      path: '/v1/commands',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({requestId: 'r1', name: 'x', args: {}}),
    })
    expect(res.status).toBe(401)
    expect(session.calls).toEqual([])
  })

  test('rejects non-Bearer authorization schemes', async () => {
    const {baseUrl, session} = await startServer({})
    const res = await request(baseUrl, {
      method: 'GET',
      path: '/v1/health',
      headers: {
        Authorization: `Basic ${Buffer.from('u:p').toString('base64')}`,
      },
    })
    expect(res.status).toBe(401)
    expect(session.calls).toEqual([])
  })

  test('accepts the configured bearer token', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  test('token and authenticate combine with AND semantics', async () => {
    const rejecting = await startServer({
      config: resolveBridgeConfig({token: TOKEN, authenticate: () => false}),
    })
    const denied = await request(rejecting.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(denied.status).toBe(401)

    const accepting = await startServer({
      config: resolveBridgeConfig({
        token: TOKEN,
        authenticate: (req) => req.headers['x-agent'] === 'yes',
      }),
    })
    const missingCustom = await request(accepting.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(missingCustom.status).toBe(401)
    const both = await request(accepting.baseUrl, {
      path: '/v1/health',
      headers: authedHeaders({'X-Agent': 'yes'}),
    })
    expect(both.status).toBe(200)
  })

  test('supports authenticate-only configuration', async () => {
    const {baseUrl} = await startServer({
      config: resolveBridgeConfig({
        authenticate: async (req) =>
          req.headers.authorization === 'Bearer let-me-in',
      }),
    })
    const ok = await request(baseUrl, {
      path: '/v1/health',
      headers: {Authorization: 'Bearer let-me-in'},
    })
    expect(ok.status).toBe(200)
    const bad = await request(baseUrl, {
      path: '/v1/health',
      headers: {Authorization: 'Bearer someone-else'},
    })
    expect(bad.status).toBe(401)
  })

  test('treats a throwing authenticate callback as rejection', async () => {
    const {baseUrl} = await startServer({
      config: resolveBridgeConfig({
        authenticate: () => {
          throw new Error('host bug')
        },
      }),
    })
    const res = await request(baseUrl, {path: '/v1/health'})
    expect(res.status).toBe(401)
  })
})

describe('websocket credential extraction', () => {
  function fakeUpgradeRequest(protocols?: string): IncomingMessage {
    return {
      headers: {
        upgrade: 'websocket',
        ...(protocols !== undefined
          ? {'sec-websocket-protocol': protocols}
          : {}),
      },
    } as IncomingMessage
  }

  test('reads credentials from the token.<encoded> subprotocol', async () => {
    const token = 'tok en/+&=?'
    const config = resolveBridgeConfig({token})
    const req = fakeUpgradeRequest(
      `camera-studio-v1, token.${encodeURIComponent(token)}`,
    )
    await expect(authorizeRequest(req, config)).resolves.toBe(true)
  })

  test('the camera-studio-v1 protocol identifier is not a credential', async () => {
    const config = resolveBridgeConfig({token: 'camera-studio-v1'})
    const req = fakeUpgradeRequest('camera-studio-v1')
    await expect(authorizeRequest(req, config)).resolves.toBe(false)
  })

  test('rejects upgrades without a credential subprotocol', async () => {
    const config = resolveBridgeConfig({token: TOKEN})
    await expect(authorizeRequest(fakeUpgradeRequest(), config)).resolves.toBe(
      false,
    )
    await expect(
      authorizeRequest(fakeUpgradeRequest('camera-studio-v1'), config),
    ).resolves.toBe(false)
  })

  test('rejects upgrades with a wrong token subprotocol', async () => {
    const config = resolveBridgeConfig({token: TOKEN})
    const req = fakeUpgradeRequest('camera-studio-v1, token.wrong')
    await expect(authorizeRequest(req, config)).resolves.toBe(false)
  })
})

describe('CORS', () => {
  test('sets Vary: Origin on every response', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(res.headers.vary).toMatch(/Origin/i)
  })

  test('answers preflight only for whitelisted origins', async () => {
    const {baseUrl} = await startServer({
      config: resolveBridgeConfig({
        token: TOKEN,
        corsOrigins: ['https://agent.example'],
      }),
    })
    const allowed = await request(baseUrl, {
      method: 'OPTIONS',
      path: '/v1/commands',
      headers: {Origin: 'https://agent.example'},
    })
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://agent.example',
    )
    expect(allowed.headers['access-control-allow-methods']).toMatch(/POST/)
    expect(allowed.headers['access-control-allow-headers']).toMatch(
      /Authorization/i,
    )

    const denied = await request(baseUrl, {
      method: 'OPTIONS',
      path: '/v1/commands',
      headers: {Origin: 'https://evil.example'},
    })
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('echoes the whitelisted origin on actual responses', async () => {
    const {baseUrl} = await startServer({
      config: resolveBridgeConfig({
        token: TOKEN,
        corsOrigins: ['https://agent.example'],
      }),
    })
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders({Origin: 'https://agent.example'}),
    })
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://agent.example',
    )
    const other = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders({Origin: 'https://evil.example'}),
    })
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('emits no allow headers when the whitelist is empty', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      method: 'OPTIONS',
      path: '/v1/commands',
      headers: {Origin: 'https://agent.example'},
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-methods']).toBeUndefined()
  })

  test('never combines a wildcard origin with credentials', async () => {
    const {baseUrl} = await startServer({
      config: resolveBridgeConfig({token: TOKEN, corsOrigins: ['*']}),
    })
    const preflight = await request(baseUrl, {
      method: 'OPTIONS',
      path: '/v1/commands',
      headers: {Origin: 'https://agent.example'},
    })
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(
      preflight.headers['access-control-allow-credentials'],
    ).toBeUndefined()
    const actual = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders({Origin: 'https://agent.example'}),
    })
    expect(actual.headers['access-control-allow-origin']).toBe('*')
    expect(actual.headers['access-control-allow-credentials']).toBeUndefined()
  })
})

describe('health and schema', () => {
  test('reports the bridge running and the scene unavailable without a page', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      result: {bridge: 'running', scene: 'unavailable'},
    })
  })

  test('reports the connected scene after hello', async () => {
    const session = createFakeSession()
    session.scene = 'connected'
    session.sessionId = 'session-1'
    const {baseUrl} = await startServer({session})
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    expect(res.json()).toEqual({
      ok: true,
      result: {bridge: 'running', scene: 'connected', sessionId: 'session-1'},
    })
  })

  test('schema is unavailable without a scene', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/schema',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(503)
    expect(res.json()).toEqual({
      ok: false,
      error: {
        code: 'SCENE_UNAVAILABLE',
        message: expect.any(String),
        retryable: true,
      },
    })
  })

  test('returns the cached schema after the scene hello', async () => {
    const session = createFakeSession()
    session.schemaValue = {
      apiVersion: 1,
      commands: [{name: 'scene.getSnapshot'}],
    }
    const {baseUrl} = await startServer({session})
    const res = await request(baseUrl, {
      path: '/v1/schema',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: session.schemaValue})
  })

  test('unknown routes return 404', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/nope',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(404)
    expect(res.json().ok).toBe(false)
  })
})

describe('command transport errors', () => {
  test('rejects bodies larger than maxCommandBytes with 413', async () => {
    const {baseUrl, session} = await startServer({
      config: resolveBridgeConfig({token: TOKEN, maxCommandBytes: 64}),
    })
    const res = await request(
      baseUrl,
      postCommand(
        JSON.stringify({requestId: 'r1', name: 'x'.repeat(128), args: {}}),
      ),
    )
    expect(res.status).toBe(413)
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(session.calls).toEqual([])
  })

  test('rejects declared Content-Length over the limit with a delivered 413', async () => {
    const {baseUrl, session} = await startServer({
      config: resolveBridgeConfig({token: TOKEN, maxCommandBytes: 64}),
    })
    // 显式 Content-Length + 大 body:服务端在客户端仍在发送时就要响应,
    // 必须排空再应答,否则 destroy 会把未读入站数据连同 413 一起 RST 掉。
    // 重复多次锁定确定性送达,而不是侥幸时序。
    const body = JSON.stringify({
      requestId: 'r1',
      name: 'x'.repeat(256 * 1024),
      args: {},
    })
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await new Promise<HttpResult>((resolve, reject) => {
        const url = new URL('/v1/commands', baseUrl)
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: authedHeaders({
              'Content-Type': 'application/json',
              'Content-Length': String(Buffer.byteLength(body)),
            }),
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: text,
                json: () => JSON.parse(text),
              })
            })
          },
        )
        req.on('error', reject)
        req.end(body)
      })
      expect(res.status).toBe(413)
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
    }
    expect(session.calls).toEqual([])
  })

  test('counts streaming bodies against maxCommandBytes', async () => {
    const {baseUrl, session} = await startServer({
      config: resolveBridgeConfig({token: TOKEN, maxCommandBytes: 100}),
    })
    // 不带 Content-Length 的分块体,服务端必须流式累计而不是信任头部
    const res = await new Promise<HttpResult>((resolve, reject) => {
      const url = new URL('/v1/commands', baseUrl)
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: authedHeaders({'Content-Type': 'application/json'}),
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
      req.write('x'.repeat(64))
      req.write('y'.repeat(64))
      req.end()
    })
    expect(res.status).toBe(413)
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(session.calls).toEqual([])
  })

  test('rejects invalid JSON with 400', async () => {
    const {baseUrl, session} = await startServer({})
    const res = await request(baseUrl, postCommand('{not json'))
    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('INVALID_ARGUMENT')
    expect(session.calls).toEqual([])
  })

  test('requires non-empty requestId and name and an args key', async () => {
    const {baseUrl, session} = await startServer({})
    for (const body of [
      JSON.stringify({name: 'x', args: {}}),
      JSON.stringify({requestId: '', name: 'x', args: {}}),
      JSON.stringify({requestId: 'r1', args: {}}),
      JSON.stringify({requestId: 'r1', name: 'x'}),
      JSON.stringify(['not', 'an', 'object']),
    ]) {
      const res = await request(baseUrl, postCommand(body))
      expect(res.status).toBe(400)
      expect(res.json().error.code).toBe('INVALID_ARGUMENT')
    }
    expect(session.calls).toEqual([])
  })

  test('passes the command to the session and returns success verbatim', async () => {
    const session = createFakeSession()
    session.nextResponse = {ok: true, result: {objects: []}, revision: 42}
    const {baseUrl} = await startServer({session})
    const res = await request(
      baseUrl,
      postCommand(
        JSON.stringify({
          requestId: 'agent-1',
          name: 'scene.getSnapshot',
          args: {deep: true},
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      result: {objects: []},
      revision: 42,
    })
    expect(session.calls).toEqual([
      {requestId: 'agent-1', name: 'scene.getSnapshot', args: {deep: true}},
    ])
  })

  test.each([
    ['REVISION_CONFLICT', 409],
    ['OBJECT_NOT_FOUND', 404],
    ['INVALID_ARGUMENT', 422],
  ])('maps %s failures to HTTP %i', async (code, status) => {
    const session = createFakeSession()
    session.nextResponse = {
      ok: false,
      error: {code, message: 'failed', retryable: false},
    }
    const {baseUrl} = await startServer({session})
    const res = await request(
      baseUrl,
      postCommand(JSON.stringify({requestId: 'r1', name: 'x', args: {}})),
    )
    expect(res.status).toBe(status)
    expect(res.json()).toEqual({
      ok: false,
      error: {code, message: 'failed', retryable: false},
    })
  })

  test('error responses contain only code/message/retryable/details, never a stack', async () => {
    const session = createFakeSession()
    session.nextResponse = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'boom',
        retryable: false,
        details: {expectedRevision: 41},
        // 浏览器侧不该带来 stack;即使带来也绝不透传给 HTTP 客户端
        stack: 'Error: boom\n    at secret.ts:1:1',
      } as any,
    }
    const {baseUrl} = await startServer({session})
    const res = await request(
      baseUrl,
      postCommand(JSON.stringify({requestId: 'r1', name: 'x', args: {}})),
    )
    expect(res.status).toBe(500)
    const error = res.json().error
    expect(Object.keys(error).sort()).toEqual([
      'code',
      'details',
      'message',
      'retryable',
    ])
    expect(JSON.stringify(res.body)).not.toContain('secret.ts')
  })

  test('unexpected session exceptions map to 500 without leaking internals', async () => {
    const session = createFakeSession()
    session.nextError = new Error('secret internals at /private/path.ts:9')
    const {baseUrl} = await startServer({session})
    const res = await request(
      baseUrl,
      postCommand(JSON.stringify({requestId: 'r1', name: 'x', args: {}})),
    )
    expect(res.status).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
    expect(res.body).not.toContain('secret internals')
    expect(res.body).not.toContain('/private/path.ts')
  })
})
