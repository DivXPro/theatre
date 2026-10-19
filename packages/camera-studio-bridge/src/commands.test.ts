/**
 * Task 4 Step 3:requestId 去重(HTTP 端到端)+ RequestDeduplicator 单元测试。
 *
 * HTTP 级:同 requestId 在途和已完成的写请求共享结果;不同 name/args →
 * 409 INVALID_STATE;query 不被长期缓存。
 * 单元级:stable stringify 指纹(递归排序对象键、数组保序)与 1000 条 LRU。
 */
import http from 'http'
import type {AddressInfo} from 'net'
import {WebSocket} from 'ws'
import {BRIDGE_WS_PROTOCOL} from './auth'
import {resolveBridgeConfig} from './config'
import {createHttpServer} from './httpServer'
import {RequestDeduplicator, stableStringify} from './RequestDeduplicator'
import {createSceneSession} from './SceneSession'
import type {CommandResponse, SceneWireMessage} from './types'

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'test-bridge-token'

const SCHEMA = {
  apiVersion: 1,
  commands: [
    {name: 'scene.getSnapshot', kind: 'query'},
    {name: 'models.create', kind: 'mutation'},
    {name: 'cameras.create', kind: 'mutation'},
  ],
}

type WireCommand = Extract<SceneWireMessage, {type: 'command'}>

type FakeBrowser = {
  ws: WebSocket
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
  baseUrl: string
  browser: FakeBrowser
}

async function startBridgeWithBrowser(): Promise<StartedBridge> {
  const config = resolveBridgeConfig({token: TOKEN})
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
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [
      BRIDGE_WS_PROTOCOL,
      `token.${encodeURIComponent(TOKEN)}`,
    ])
    cleanups.push(() => client.terminate())
    client.on('open', () => resolve(client))
    client.on('error', reject)
  })
  const browser = createFakeBrowser(ws)
  browser.send({type: 'hello', sessionId: 'session-1', schema: SCHEMA})
  // hello 处理是异步的:轮询 health 到 connected 再开始
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await request(baseUrl, {
      path: '/v1/health',
      headers: authedHeaders(),
    })
    if (res.json().result.scene === 'connected') return {baseUrl, browser}
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('scene did not become connected after hello')
}

function createFakeBrowser(ws: WebSocket): FakeBrowser {
  const messages: SceneWireMessage[] = []
  const waiters: Array<{
    pred: (message: SceneWireMessage) => boolean
    resolve: (message: SceneWireMessage) => void
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
  return {
    ws,
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
        waiters.push({pred, resolve, timer})
      })
    },
  }
}

type HttpResult = {
  status: number
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

function commandBody(requestId: string, name: string, args: unknown): string {
  return JSON.stringify({requestId, name, args})
}

describe('requestId deduplication over HTTP', () => {
  test('shares an in-flight write across duplicate requestIds', async () => {
    const {baseUrl, browser} = await startBridgeWithBrowser()
    const body = commandBody('r-dup', 'models.create', {assetId: 'a1'})

    // 第一个请求在途(浏览器 deferred 未完成)时,同 requestId 再发两次
    const p1 = request(baseUrl, postCommand(body))
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    const p2 = request(baseUrl, postCommand(body))
    const p3 = request(baseUrl, postCommand(body))

    // 去重若失效,p2/p3 会各自再发 wire command 并因无人应答而挂起到
    // jest 超时——因此无需 sleep 即可区分对错
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {modelId: 'model:a1'}, revision: 3},
    })
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    for (const res of [r1, r2, r3]) {
      expect(res.status).toBe(200)
      expect(res.json()).toEqual({
        ok: true,
        result: {modelId: 'model:a1'},
        revision: 3,
      })
    }
    expect(r1.body).toBe(r2.body)
    expect(r2.body).toBe(r3.body)
    expect(browser.commands()).toHaveLength(1)
  })

  test('a completed write is still deduplicated on retry', async () => {
    const {baseUrl, browser} = await startBridgeWithBrowser()
    const body = commandBody('r-done', 'models.create', {assetId: 'a2'})

    const p1 = request(baseUrl, postCommand(body))
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {modelId: 'model:a2'}, revision: 4},
    })
    const r1 = await p1
    expect(r1.status).toBe(200)

    // 完成后再重试:仍只执行一次,返回完全相同的结果
    const r2 = await request(baseUrl, postCommand(body))
    expect(r2.status).toBe(200)
    expect(r2.body).toBe(r1.body)
    expect(browser.commands()).toHaveLength(1)
  })

  test('a failed write result is shared with later retries', async () => {
    const {baseUrl, browser} = await startBridgeWithBrowser()
    const body = commandBody('r-fail', 'models.create', {assetId: 'missing'})

    const p1 = request(baseUrl, postCommand(body))
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
    const r1 = await p1
    expect(r1.status).toBe(404)

    // 失败结果同样按第一次结果返回;调用者修正参数必须更换 requestId
    const r2 = await request(baseUrl, postCommand(body))
    expect(r2.status).toBe(404)
    expect(r2.body).toBe(r1.body)
    expect(browser.commands()).toHaveLength(1)
  })

  test('same requestId with different args returns 409 INVALID_STATE', async () => {
    const {baseUrl, browser} = await startBridgeWithBrowser()
    const p1 = request(
      baseUrl,
      postCommand(commandBody('r-conflict', 'models.create', {assetId: 'a3'})),
    )
    const command = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {modelId: 'model:a3'}},
    })
    await p1

    const differentArgs = await request(
      baseUrl,
      postCommand(
        commandBody('r-conflict', 'models.create', {assetId: 'OTHER'}),
      ),
    )
    expect(differentArgs.status).toBe(409)
    expect(differentArgs.json().error.code).toBe('INVALID_STATE')
    expect(differentArgs.json().error.details).toMatchObject({
      requestId: 'r-conflict',
    })

    const differentName = await request(
      baseUrl,
      postCommand(commandBody('r-conflict', 'cameras.create', {assetId: 'a3'})),
    )
    expect(differentName.status).toBe(409)
    expect(differentName.json().error.code).toBe('INVALID_STATE')
    expect(differentName.json().error.details).toMatchObject({
      requestId: 'r-conflict',
    })
    // 冲突请求不会转发到浏览器
    expect(browser.commands()).toHaveLength(1)
  })

  test('queries are not cached long-term: same requestId executes twice', async () => {
    const {baseUrl, browser} = await startBridgeWithBrowser()
    const body = commandBody('r-query', 'scene.getSnapshot', {})

    const p1 = request(baseUrl, postCommand(body))
    const first = (await browser.waitFor(
      (m) => m.type === 'command',
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: first.commandId,
      response: {ok: true, result: {revision: 1}},
    })
    const r1 = await p1
    expect(r1.json()).toEqual({ok: true, result: {revision: 1}})

    const p2 = request(baseUrl, postCommand(body))
    const second = (await browser.waitFor(
      (m) => m.type === 'command' && m.commandId !== first.commandId,
    )) as WireCommand
    browser.send({
      type: 'result',
      commandId: second.commandId,
      response: {ok: true, result: {revision: 2}},
    })
    const r2 = await p2
    expect(r2.json()).toEqual({ok: true, result: {revision: 2}})
    expect(browser.commands()).toHaveLength(2)
  })
})

describe('RequestDeduplicator unit', () => {
  const success = (value: number): CommandResponse => ({
    ok: true,
    result: {value},
  })

  test('stableStringify sorts object keys recursively and keeps array order', () => {
    expect(stableStringify({b: 1, a: {d: 2, c: 3}})).toBe(
      stableStringify({a: {c: 3, d: 2}, b: 1}),
    )
    expect(stableStringify({args: [1, 2]})).not.toBe(
      stableStringify({args: [2, 1]}),
    )
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('s')).toBe('"s"')
  })

  test('shares the in-flight and completed promise for the same requestId', async () => {
    const dedup = new RequestDeduplicator()
    let calls = 0
    const fn = () => Promise.resolve(success(++calls))
    const first = await dedup.execute(
      {requestId: 'a', name: 'x', args: {b: 1, a: 2}},
      fn,
    )
    // 对象键顺序不同但指纹相同 → 命中缓存
    const second = await dedup.execute(
      {requestId: 'a', name: 'x', args: {a: 2, b: 1}},
      fn,
    )
    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  test('conflicting fingerprint returns INVALID_STATE without invoking fn', async () => {
    const dedup = new RequestDeduplicator()
    let calls = 0
    const fn = () => Promise.resolve(success(++calls))
    await dedup.execute({requestId: 'a', name: 'x', args: {}}, fn)
    const conflict = await dedup.execute(
      {requestId: 'a', name: 'x', args: {different: true}},
      fn,
    )
    expect(calls).toBe(1)
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) {
      expect(conflict.error.code).toBe('INVALID_STATE')
      expect(conflict.error.details).toMatchObject({requestId: 'a'})
    }
  })

  test('evicts the least recently used entry beyond capacity', async () => {
    const dedup = new RequestDeduplicator(2)
    let calls = 0
    const fn = () => Promise.resolve(success(++calls))
    await dedup.execute({requestId: 'a', name: 'x', args: {}}, fn) // calls=1
    await dedup.execute({requestId: 'b', name: 'x', args: {}}, fn) // calls=2
    // 命中刷新 a 的位置,b 成为最久未使用
    const hitA = await dedup.execute({requestId: 'a', name: 'x', args: {}}, fn)
    expect(calls).toBe(2)
    expect(hitA).toEqual(success(1))
    await dedup.execute({requestId: 'c', name: 'x', args: {}}, fn) // calls=3,驱逐 b
    const againA = await dedup.execute(
      {requestId: 'a', name: 'x', args: {}},
      fn,
    )
    expect(calls).toBe(3)
    expect(againA).toEqual(success(1))
    // b 已被驱逐,同 requestId 重新执行
    const againB = await dedup.execute(
      {requestId: 'b', name: 'x', args: {}},
      fn,
    )
    expect(calls).toBe(4)
    expect(againB).toEqual(success(4))
  })
})
