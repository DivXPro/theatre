/**
 * Task 5 Step 1/2:HTTP 任务投影、进度、取消与断连终态。
 *
 * 测试用真实 http.Server + 真实 ws 客户端(127.0.0.1:0),组合
 * createJobStore + createSceneSession({jobs}) + createHttpServer({jobs}):
 * - job 命令返回 {jobId} 后 HTTP 为 202,body 含初始 accepted 快照,
 *   紧随其后的 GET 不会 JOB_NOT_FOUND(preflight ruling);
 * - 浏览器 job 事件驱动 GET 进度(running/0.5/phase)与终态结果;
 * - 取消经 jobs.cancel 命令转发(requestId 带 cancel- 前缀),HTTP 不假装
 *   已取消,以浏览器 job 快照为权威;不可取消 409,未知任务 404;
 * - 页面断连:pending/running → failed(SCENE_UNAVAILABLE),终态不被
 *   覆盖;重连新页面不继承旧任务,旧 sessionId 迟到事件被丢弃。
 */
import http from 'http'
import type {AddressInfo} from 'net'
import {WebSocket} from 'ws'
import {BRIDGE_WS_PROTOCOL} from './auth'
import {resolveBridgeConfig, type ResolvedBridgeConfig} from './config'
import {createHttpServer} from './httpServer'
import {createJobStore, type JobStore} from './JobStore'
import {createSceneSession, type SceneSession} from './SceneSession'
import type {BridgeJobSnapshot, SceneWireMessage} from './types'

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'test-bridge-token'

const SCHEMA = {
  apiVersion: 1,
  commands: [
    {name: 'scene.getSnapshot', kind: 'query'},
    {name: 'models.create', kind: 'mutation'},
    {name: 'exports.startVideo', kind: 'job', cancelable: true},
    // 不可取消的 job:元数据没有 cancelable 标记
    {name: 'assets.importModel', kind: 'job'},
  ],
}

type WireCommand = Extract<SceneWireMessage, {type: 'command'}>

/** fake 浏览器页面:记录收到的 wire 报文,支持按谓词等待(同 Task 4) */
type FakeBrowser = {
  ws: WebSocket
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
  jobs: JobStore
  baseUrl: string
  wsUrl: string
}

async function startBridge(
  options: {
    config?: ResolvedBridgeConfig
  } = {},
): Promise<StartedBridge> {
  const config = options.config ?? resolveBridgeConfig({token: TOKEN})
  // 取消转发复用 session.execute;闭包在调用时才读取 session,
  // 解决 jobs 与 session 的循环构造
  let session!: SceneSession
  const jobs = createJobStore({execute: (request) => session.execute(request)})
  session = createSceneSession({jobs})
  const server = createHttpServer({config, session, jobs})
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
    jobs,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
  }
}

function protocols(token: string | undefined): string[] {
  return token === undefined
    ? [BRIDGE_WS_PROTOCOL]
    : [BRIDGE_WS_PROTOCOL, `token.${encodeURIComponent(token)}`]
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

function getJob(jobId: string) {
  return {
    path: `/v1/jobs/${jobId}`,
    headers: authedHeaders(),
  } as const
}

function cancelJob(jobId: string) {
  return {
    method: 'POST',
    path: `/v1/jobs/${jobId}/cancel`,
    headers: authedHeaders(),
  } as const
}

/** 连接 + hello(sessionId 可指定),等到 health 报告 connected */
async function connectScene(
  bridge: StartedBridge,
  sessionId = 'session-1',
): Promise<FakeBrowser> {
  const browser = await connectFakeBrowser(bridge.wsUrl, TOKEN)
  browser.send({type: 'hello', sessionId, schema: SCHEMA})
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

/** 发出 job 命令并替浏览器应答 {jobId};返回 HTTP 响应 */
async function startJob(
  bridge: StartedBridge,
  browser: FakeBrowser,
  options: {requestId: string; name?: string; args?: unknown; jobId: string},
): Promise<HttpResult> {
  const pending = request(
    bridge.baseUrl,
    postCommand(
      JSON.stringify({
        requestId: options.requestId,
        name: options.name ?? 'exports.startVideo',
        args: options.args ?? {},
      }),
    ),
  )
  const command = (await browser.waitFor(
    (m) => m.type === 'command' && m.request.requestId === options.requestId,
  )) as WireCommand
  browser.send({
    type: 'result',
    commandId: command.commandId,
    response: {ok: true, result: {jobId: options.jobId}},
  })
  return pending
}

/** 轮询 GET /v1/jobs/:id 直到快照满足谓词(ws 事件处理是异步的) */
async function waitForJobState(
  bridge: StartedBridge,
  jobId: string,
  pred: (snapshot: BridgeJobSnapshot) => boolean,
): Promise<BridgeJobSnapshot> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const res = await request(bridge.baseUrl, getJob(jobId))
    if (res.status === 200) {
      const snapshot = res.json().result as BridgeJobSnapshot
      if (pred(snapshot)) return snapshot
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for job ${jobId} state`)
}

function jobSnapshot(
  jobId: string,
  overrides: Partial<BridgeJobSnapshot> = {},
): BridgeJobSnapshot {
  return {
    jobId,
    kind: 'exports.startVideo',
    state: 'running',
    progress: 0.5,
    phase: 'committed',
    cancelable: true,
    ...overrides,
  }
}

describe('job routes and state', () => {
  test('job commands return 202 with an accepted snapshot, readable immediately', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const res = await startJob(bridge, browser, {
      requestId: 'r-job-1',
      args: {cameraId: 'camera:main'},
      jobId: 'job-1',
    })
    expect(res.status).toBe(202)
    expect(res.json()).toEqual({
      ok: true,
      result: {
        jobId: 'job-1',
        kind: 'exports.startVideo',
        state: 'pending',
        progress: 0,
        phase: 'accepted',
        cancelable: true,
      },
    })
    // preflight ruling:202 之后立即 GET 不得 JOB_NOT_FOUND
    const immediate = await request(bridge.baseUrl, getJob('job-1'))
    expect(immediate.status).toBe(200)
    expect(immediate.json().result).toEqual(res.json().result)
  })

  test('browser progress and completion events drive GET state, phase and result', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {requestId: 'r-job-2', jobId: 'job-2'})

    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-2', {state: 'running', progress: 0.5}),
    })
    const running = await waitForJobState(
      bridge,
      'job-2',
      (snapshot) => snapshot.state === 'running',
    )
    expect(running.progress).toBe(0.5)
    expect(running.phase).toBe('committed')

    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-2', {
        state: 'succeeded',
        progress: 1,
        phase: 'loaded',
        result: {fileId: 'file-9', mimeType: 'video/mp4', size: 1024},
      }),
    })
    const succeeded = await waitForJobState(
      bridge,
      'job-2',
      (snapshot) => snapshot.state === 'succeeded',
    )
    expect(succeeded.result).toEqual({
      fileId: 'file-9',
      mimeType: 'video/mp4',
      size: 1024,
    })
  })

  test('unknown jobs return 404 JOB_NOT_FOUND', async () => {
    const bridge = await startBridge()
    await connectScene(bridge)
    const res = await request(bridge.baseUrl, getJob('job-nope'))
    expect(res.status).toBe(404)
    expect(res.json().error.code).toBe('JOB_NOT_FOUND')
  })

  test('cancelling a non-cancelable job returns 409 and forwards nothing', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {
      requestId: 'r-job-3',
      name: 'assets.importModel',
      args: {fileId: 'file-1'},
      jobId: 'job-3',
    })
    const res = await request(bridge.baseUrl, cancelJob('job-3'))
    expect(res.status).toBe(409)
    expect(res.json().error.code).toBe('JOB_NOT_CANCELABLE')
    expect(
      browser.commands().filter((c) => c.request.name === 'jobs.cancel'),
    ).toEqual([])
  })

  test('cancelling an unknown job returns 404 JOB_NOT_FOUND', async () => {
    const bridge = await startBridge()
    await connectScene(bridge)
    const res = await request(bridge.baseUrl, cancelJob('job-ghost'))
    expect(res.status).toBe(404)
    expect(res.json().error.code).toBe('JOB_NOT_FOUND')
  })

  test('mutation results shaped like {jobId} are not projected as jobs', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    const res = await startJob(bridge, browser, {
      requestId: 'r-mutation',
      name: 'models.create',
      args: {assetId: 'a1'},
      jobId: 'not-a-job',
    })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ok: true, result: {jobId: 'not-a-job'}})
    const lookup = await request(bridge.baseUrl, getJob('not-a-job'))
    expect(lookup.status).toBe(404)
  })
})

describe('cancellation', () => {
  test('forwards jobs.cancel with a cancel- requestId and never fakes cancellation', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {requestId: 'r-job-4', jobId: 'job-4'})
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-4', {state: 'running', progress: 0.25}),
    })
    await waitForJobState(bridge, 'job-4', (s) => s.state === 'running')

    const pending = request(bridge.baseUrl, cancelJob('job-4'))
    const command = (await browser.waitFor(
      (m) => m.type === 'command' && m.request.name === 'jobs.cancel',
    )) as WireCommand
    expect(command.request.args).toEqual({jobId: 'job-4'})
    // 桥接生成的 requestId 带 cancel- 前缀,不与 Agent 请求冲突
    expect(command.request.requestId).toMatch(/^cancel-/)
    expect(command.request.requestId).not.toBe('r-job-4')
    browser.send({
      type: 'result',
      commandId: command.commandId,
      response: {ok: true, result: {}},
    })
    const res = await pending
    expect(res.status).toBe(202)
    // HTTP 不假装已取消:浏览器快照事件未到,状态仍是 running
    expect(res.json().result.state).toBe('running')

    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-4', {
        state: 'cancelled',
        progress: 0.25,
        error: {code: 'JOB_CANCELLED', message: '已取消', retryable: false},
      }),
    })
    const cancelled = await waitForJobState(
      bridge,
      'job-4',
      (s) => s.state === 'cancelled',
    )
    expect(cancelled.error?.code).toBe('JOB_CANCELLED')

    // 已取消的任务再取消是幂等读,不重复转发 jobs.cancel
    const again = await request(bridge.baseUrl, cancelJob('job-4'))
    expect(again.status).toBe(202)
    expect(again.json().result.state).toBe('cancelled')
    expect(
      browser.commands().filter((c) => c.request.name === 'jobs.cancel'),
    ).toHaveLength(1)
  })

  test('terminal jobs other than cancelled cannot be cancelled', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {requestId: 'r-job-5', jobId: 'job-5'})
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-5', {state: 'succeeded', progress: 1}),
    })
    await waitForJobState(bridge, 'job-5', (s) => s.state === 'succeeded')
    const res = await request(bridge.baseUrl, cancelJob('job-5'))
    expect(res.status).toBe(409)
    expect(res.json().error.code).toBe('JOB_NOT_CANCELABLE')
    expect(
      browser.commands().filter((c) => c.request.name === 'jobs.cancel'),
    ).toEqual([])
  })
})

describe('disconnect terminal states', () => {
  test('fails pending/running jobs with SCENE_UNAVAILABLE; terminal states survive', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {
      requestId: 'r-pending',
      jobId: 'job-pending',
    })
    await startJob(bridge, browser, {
      requestId: 'r-running',
      jobId: 'job-running',
    })
    await startJob(bridge, browser, {requestId: 'r-done', jobId: 'job-done'})
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-running', {state: 'running', progress: 0.5}),
    })
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-done', {
        state: 'succeeded',
        progress: 1,
        result: {fileId: 'file-done'},
      }),
    })
    await waitForJobState(bridge, 'job-done', (s) => s.state === 'succeeded')
    await waitForJobState(bridge, 'job-running', (s) => s.state === 'running')

    browser.ws.terminate()
    const pending = await waitForJobState(
      bridge,
      'job-pending',
      (s) => s.state === 'failed',
    )
    expect(pending.error?.code).toBe('SCENE_UNAVAILABLE')
    const running = await waitForJobState(
      bridge,
      'job-running',
      (s) => s.state === 'failed',
    )
    expect(running.error?.code).toBe('SCENE_UNAVAILABLE')
    // 终态不被断连覆盖
    const done = await request(bridge.baseUrl, getJob('job-done'))
    expect(done.json().result.state).toBe('succeeded')
    expect(done.json().result.result).toEqual({fileId: 'file-done'})
  })

  test('a reconnected page does not inherit old jobs; late events from the old session are dropped', async () => {
    const bridge = await startBridge()
    const first = await connectScene(bridge, 'session-1')
    await startJob(bridge, first, {requestId: 'r-old', jobId: 'job-old'})
    first.ws.terminate()
    await waitForJobState(bridge, 'job-old', (s) => s.state === 'failed')

    const second = await connectScene(bridge, 'session-2')
    // 旧任务保持 failed,不因新页面 hello 复活为 running
    const afterReconnect = await request(bridge.baseUrl, getJob('job-old'))
    expect(afterReconnect.json().result.state).toBe('failed')
    // 旧连接迟到的 job 事件被代次闸门丢弃
    second.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-old', {state: 'running', progress: 0.9}),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const afterLateEvent = await request(bridge.baseUrl, getJob('job-old'))
    expect(afterLateEvent.json().result.state).toBe('failed')

    // 新页面照常开启并推进自己的任务
    await startJob(bridge, second, {requestId: 'r-new', jobId: 'job-new'})
    second.send({
      type: 'job',
      sessionId: 'session-2',
      snapshot: jobSnapshot('job-new', {state: 'running', progress: 0.1}),
    })
    const fresh = await waitForJobState(
      bridge,
      'job-new',
      (s) => s.state === 'running',
    )
    expect(fresh.progress).toBe(0.1)
  })

  test('terminal events from the browser are never overwritten by late progress', async () => {
    const bridge = await startBridge()
    const browser = await connectScene(bridge)
    await startJob(bridge, browser, {requestId: 'r-job-6', jobId: 'job-6'})
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-6', {state: 'succeeded', progress: 1}),
    })
    await waitForJobState(bridge, 'job-6', (s) => s.state === 'succeeded')
    // 同一连接上迟到的 running 事件也不得覆盖终态
    browser.send({
      type: 'job',
      sessionId: 'session-1',
      snapshot: jobSnapshot('job-6', {state: 'running', progress: 0.3}),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const res = await request(bridge.baseUrl, getJob('job-6'))
    expect(res.json().result.state).toBe('succeeded')
    expect(res.json().result.progress).toBe(1)
  })
})
