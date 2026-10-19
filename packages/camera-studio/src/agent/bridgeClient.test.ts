/*
 * @jest-environment jsdom
 */
/**
 * 浏览器桥接客户端(2026-10-19,Task 6,spec §10.2/§10.4):
 *
 * - 握手:WebSocket subprotocol 为 `camera-studio-v1` +
 *   `token.<encodeURIComponent(token)`;onopen 生成新 sessionId 并发送
 *   hello(sessionId + registry.describe() schema);
 * - 命令:command 报文 → registry.execute(name, args, {requestId 原样,
 *   signal});成功回 result 报文(项目 mutation 带当前 revision,query 不带);
 *   AgentApiError/未知异常回结构化 error 报文,绝不因错误关闭 socket;
 * - 任务:runtime.jobs 事件 → job 报文,sessionId 与 hello 一致;
 * - 断线:指数退避重连(上限 5 秒),每次连接生成新 sessionId;
 *   close() 后停止重连、摘除消息处理、拒绝新执行;
 * - 二进制:args 里的 fileRef 先经 bridgeFiles 水合,失败结构化上抛,
 *   不调用领域命令(token 绝不进报文/日志)。
 *
 * WebSocket 用模块级 fake(赋值 globalThis.WebSocket),fetch 在
 * bridgeClient 层只经 bridgeFiles 间接调用,这里用全局 jest.fn 替身。
 */
import {AgentApiError} from './errors'
import type {JobSnapshot} from './types'
import {createAgentBridgeClient} from './bridgeClient'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  readonly protocols: string[]
  readonly sent: string[] = []
  readyState = 0
  closeCalled = false
  onopen: (() => void) | null = null
  onmessage: ((event: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = Array.isArray(protocols)
      ? protocols
      : protocols
        ? [protocols]
        : []
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalled = true
    this.readyState = 3
  }

  /** 以下模拟对端(桥接)行为 */
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverSend(message: unknown): void {
    this.onmessage?.({data: JSON.stringify(message)})
  }

  serverClose(): void {
    this.readyState = 3
    this.onclose?.()
  }

  lastSent(): {
    type: string
    sessionId?: string
    commandId?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema?: any
  } {
    return JSON.parse(this.sent[this.sent.length - 1])
  }
}

/** 纯微任务链冲刷(hydrate → execute → send 全微任务;不依赖计时器) */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function makeRegistry() {
  const execute = jest.fn<Promise<unknown>, [string, unknown, unknown]>()
  const describe = jest.fn(() => ({
    apiVersion: 1 as const,
    commands: [
      {
        name: 'objects.update',
        kind: 'mutation' as const,
        stateDomain: 'project' as const,
        undoable: 'single-step' as const,
        inputSchema: {},
        outputSchema: {},
        errorCodes: [],
        acceptsExpectedRevision: true,
      },
      {
        name: 'scene.getSnapshot',
        kind: 'query' as const,
        stateDomain: 'project' as const,
        undoable: 'none' as const,
        inputSchema: {},
        outputSchema: {},
        errorCodes: [],
        acceptsExpectedRevision: false,
      },
      {
        name: 'assets.importModel',
        kind: 'job' as const,
        stateDomain: 'asset' as const,
        undoable: 'none' as const,
        inputSchema: {},
        outputSchema: {},
        errorCodes: [],
        acceptsExpectedRevision: false,
      },
    ],
  }))
  return {execute, describe}
}

function makeRuntime() {
  let listener: ((snapshot: JobSnapshot<unknown>) => void) | undefined
  const unsubscribe = jest.fn(() => {
    listener = undefined
  })
  return {
    revision: 42,
    jobs: {
      subscribe: (l: (snapshot: JobSnapshot<unknown>) => void) => {
        listener = l
        return unsubscribe
      },
      cancel: jest.fn(),
    },
    unsubscribe,
    emitJob(snapshot: JobSnapshot<unknown>): void {
      listener?.(snapshot)
    },
  }
}

const config = {
  url: 'ws://127.0.0.1:43110',
  token: 'tok/en 1',
  httpUrl: 'http://127.0.0.1:43110',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function startClient(registry: any, runtime: any) {
  return createAgentBridgeClient({
    registry,
    runtime,
    config,
  })
}

beforeEach(() => {
  FakeWebSocket.instances = []
  ;(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).WebSocket
  delete (globalThis as Record<string, unknown>).fetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('bridgeClient 握手与命令执行', () => {
  test('连接使用 camera-studio-v1 + token.<encoded> subprotocol,open 后发送 hello', () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const client = startClient(registry, runtime)

    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe('ws://127.0.0.1:43110')
    expect(ws.protocols).toEqual([
      'camera-studio-v1',
      `token.${encodeURIComponent('tok/en 1')}`,
    ])

    ws.serverOpen()
    const hello = JSON.parse(ws.sent[0])
    expect(hello.type).toBe('hello')
    expect(typeof hello.sessionId).toBe('string')
    expect(hello.sessionId.length).toBeGreaterThan(0)
    expect(hello.schema).toEqual(registry.describe())
    client.close()
  })

  test('command 报文 → registry.execute,name/args 一致,requestId 原样透传;项目 mutation 成功带 revision', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    registry.execute.mockResolvedValue({updated: true})
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({
      type: 'command',
      commandId: 'c1',
      request: {
        requestId: 'req-1',
        name: 'objects.update',
        args: {objectId: 'model:M'},
      },
    })
    await flushAsync()

    expect(registry.execute).toHaveBeenCalledTimes(1)
    const [name, args, context] = registry.execute.mock.calls[0]
    expect(name).toBe('objects.update')
    expect(args).toEqual({objectId: 'model:M'})
    expect(context).toMatchObject({requestId: 'req-1'})
    expect((context as {signal: AbortSignal}).signal).toBeInstanceOf(
      AbortSignal,
    )

    expect(ws.lastSent()).toEqual({
      type: 'result',
      commandId: 'c1',
      response: {ok: true, result: {updated: true}, revision: 42},
    })
    client.close()
  })

  test('query 命令成功不携带 revision', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    registry.execute.mockResolvedValue({revision: 42, objects: []})
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({
      type: 'command',
      commandId: 'c2',
      request: {requestId: 'req-2', name: 'scene.getSnapshot', args: undefined},
    })
    await flushAsync()

    const message = ws.lastSent()
    expect(message.type).toBe('result')
    expect(message.response.ok).toBe(true)
    expect(message.response.result).toEqual({revision: 42, objects: []})
    expect('revision' in message.response).toBe(false)
    client.close()
  })

  test('AgentApiError → 结构化 error 报文,socket 保持打开', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    registry.execute.mockRejectedValue(
      new AgentApiError('REVISION_CONFLICT', 'revision 冲突', {
        retryable: false,
        details: {expectedRevision: 1, actualRevision: 42},
      }),
    )
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({
      type: 'command',
      commandId: 'c3',
      request: {
        requestId: 'req-3',
        name: 'objects.update',
        args: {objectId: 'model:M'},
      },
    })
    await flushAsync()

    expect(ws.lastSent()).toEqual({
      type: 'error',
      commandId: 'c3',
      response: {
        ok: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'revision 冲突',
          retryable: false,
          details: {expectedRevision: 1, actualRevision: 42},
        },
      },
    })
    expect(ws.closeCalled).toBe(false)
    expect(ws.readyState).toBe(1)
    client.close()
  })

  test('未知异常归一为 INTERNAL_ERROR,socket 保持打开', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    registry.execute.mockRejectedValue(new Error('boom'))
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({
      type: 'command',
      commandId: 'c4',
      request: {
        requestId: 'req-4',
        name: 'objects.update',
        args: {},
      },
    })
    await flushAsync()

    const message = ws.lastSent()
    expect(message.type).toBe('error')
    expect(message.commandId).toBe('c4')
    expect(message.response.ok).toBe(false)
    expect(message.response.error.code).toBe('INTERNAL_ERROR')
    expect(message.response.error.retryable).toBe(false)
    expect(ws.closeCalled).toBe(false)
    client.close()
  })

  test('fileRef 水合失败 → 结构化错误,registry.execute 不被调用,token 不出现在报文里', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(globalThis as Record<string, unknown>).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({
      type: 'command',
      commandId: 'c9',
      request: {
        requestId: 'req-9',
        name: 'assets.importModel',
        args: {
          file: {
            fileId: 'f1',
            fileName: 'Y Bot.glb',
            mimeType: 'model/gltf-binary',
          },
        },
      },
    })
    await flushAsync()

    expect(registry.execute).not.toHaveBeenCalled()
    const message = ws.lastSent()
    expect(message.type).toBe('error')
    expect(message.commandId).toBe('c9')
    expect(message.response.ok).toBe(false)
    expect(message.response.error.code).toBe('NETWORK_ERROR')
    // token 绝不出现在报文与日志里
    expect(JSON.stringify(ws.sent)).not.toContain('tok/en 1')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('tok/en 1')
    // CORS 日志保留 httpUrl 与页面 origin
    expect(JSON.stringify(errorSpy.mock.calls)).toContain(
      'http://127.0.0.1:43110',
    )
    expect(ws.closeCalled).toBe(false)
    client.close()
  })
})

describe('bridgeClient 任务事件', () => {
  test('job 事件携带与 hello 相同的 sessionId', async () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    const helloSessionId = JSON.parse(ws.sent[0]).sessionId

    runtime.emitJob({
      jobId: 'j1',
      kind: 'exports.startVideo',
      state: 'running',
      progress: 0.5,
      phase: 'committed',
      cancelable: true,
    })
    await flushAsync()

    const message = ws.lastSent()
    expect(message.type).toBe('job')
    expect(message.sessionId).toBe(helloSessionId)
    expect(message.snapshot).toMatchObject({
      jobId: 'j1',
      state: 'running',
      progress: 0.5,
    })
    client.close()
  })

  test('cancel 报文转发 runtime.jobs.cancel', () => {
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    ws.serverSend({type: 'cancel', jobId: 'j7'})
    expect(runtime.jobs.cancel).toHaveBeenCalledWith('j7')
    client.close()
  })
})

describe('bridgeClient 重连与关闭', () => {
  test('断线后指数退避重连,新连接生成新 sessionId', () => {
    jest.useFakeTimers()
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const client = startClient(registry, runtime)
    const ws1 = FakeWebSocket.instances[0]
    ws1.serverOpen()
    const sessionId1 = JSON.parse(ws1.sent[0]).sessionId

    ws1.serverClose()
    expect(FakeWebSocket.instances).toHaveLength(1)

    jest.advanceTimersByTime(250)
    expect(FakeWebSocket.instances).toHaveLength(2)
    const ws2 = FakeWebSocket.instances[1]
    ws2.serverOpen()
    const sessionId2 = JSON.parse(ws2.sent[0]).sessionId
    expect(sessionId2).not.toBe(sessionId1)
    // 新连接重新 hello,schema 照带
    expect(JSON.parse(ws2.sent[0]).schema).toEqual(registry.describe())

    // 再次断线:退避增长(第二次 ≥ 500ms 才重连)
    ws2.serverClose()
    jest.advanceTimersByTime(249)
    expect(FakeWebSocket.instances).toHaveLength(2)
    jest.advanceTimersByTime(251)
    expect(FakeWebSocket.instances).toHaveLength(3)
    client.close()
  })

  test('close() 后停止重连并拒绝新执行', async () => {
    jest.useFakeTimers()
    const registry = makeRegistry()
    const runtime = makeRuntime()
    const client = startClient(registry, runtime)
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()

    client.close()
    expect(ws.closeCalled).toBe(true)
    expect(runtime.unsubscribe).toHaveBeenCalled()

    // 后续断线事件不再触发重连
    ws.serverClose()
    jest.advanceTimersByTime(30000)
    expect(FakeWebSocket.instances).toHaveLength(1)

    // 消息处理已摘除:迟到的 command 不执行
    ws.serverSend({
      type: 'command',
      commandId: 'c-late',
      request: {requestId: 'req-late', name: 'objects.update', args: {}},
    })
    await flushAsync()
    expect(registry.execute).not.toHaveBeenCalled()
  })
})
