/**
 * 单场景 WebSocket 会话(spec 10.4,Task 4)。
 *
 * 职责:
 * - `attachUpgrade`:经 `WebSocketServer({noServer:true})` 完成握手;
 *   凭据由 httpServer upgrade 层先解析 subprotocol(`token.<encoded>`)再调
 *   `authorizeRequest` 校验,这里 `handleProtocols` 只选择 `camera-studio-v1`;
 * - 单场景:第二个活动连接收 INVALID_STATE 错误报文后被关闭,第一连接的
 *   连接状态、schema 与 pending 命令不受影响;
 * - 命令转发:每个命令分配 randomUUID 的 commandId,pending Map 保存
 *   resolve;浏览器 result/error 报文按 commandId 找回;未知 commandId
 *   直接忽略(不创建新请求、不崩溃);无法解析的报文同样忽略;
 * - 断连:页面 close/error 后场景立即不可用,全部 pending 以
 *   SCENE_UNAVAILABLE 结束(503,不等待超时);
 * - 去重:query(schema kind === 'query')直接转发不进缓存;其余命令经
 *   RequestDeduplicator;新 hello 建立新场景会话,去重作用域随之重置
 *   (spec 8.5:同一桥接和场景会话内去重)。
 *
 * 本模块不做领域 schema 校验:args 原样转发给浏览器命令 validator。
 * job 命令的 202 投影在 Task 5;这里只保证浏览器返回的 {jobId} 结果原样透传。
 */

import {randomUUID} from 'crypto'
import type {IncomingMessage} from 'http'
import type {Duplex} from 'stream'
import type {WebSocket} from 'ws';
import { WebSocketServer} from 'ws'
import {BRIDGE_WS_PROTOCOL} from './auth'
import type {BridgeSessionHandle, SceneHealth} from './httpServer'
import {RequestDeduplicator} from './RequestDeduplicator'
import type {
  CommandFailure,
  CommandRequest,
  CommandResponse,
  SceneWireMessage,
} from './types'

export type SceneSession = BridgeSessionHandle & {
  attachUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  /** 终止活动连接、以 SCENE_UNAVAILABLE 结束全部 pending、关闭 WS 服务 */
  close(): Promise<void>
}

/** 场景不可用(未连接/hello 前/断连后):503,可重试 */
function sceneUnavailable(): CommandFailure {
  return {
    ok: false,
    error: {
      code: 'SCENE_UNAVAILABLE',
      message: '浏览器场景未连接桥接',
      retryable: true,
    },
  }
}

/**
 * 从 hello 携带的 schema 判断命令是否为 query。
 * schema 不可信(对端是浏览器):逐层收窄,形状不符一律按非 query 处理。
 */
function isQueryCommand(schema: unknown, name: string): boolean {
  if (typeof schema !== 'object' || schema === null) return false
  const commands = (schema as {commands?: unknown}).commands
  if (!Array.isArray(commands)) return false
  for (const entry of commands) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as {name?: unknown; kind?: unknown}
    if (candidate.name === name) return candidate.kind === 'query'
  }
  return false
}

export function createSceneSession(): SceneSession {
  const wss = new WebSocketServer({
    noServer: true,
    // 只选择协议标识;凭据校验在 httpServer upgrade 层的 authorizeRequest
    handleProtocols: (protocols) =>
      protocols.has(BRIDGE_WS_PROTOCOL) ? BRIDGE_WS_PROTOCOL : false,
  })

  let socket: WebSocket | undefined
  let sessionId: string | undefined
  let cachedSchema: unknown
  let dedup = new RequestDeduplicator()
  const pending = new Map<string, (response: CommandResponse) => void>()

  function failPending(failure: CommandResponse): void {
    const resolvers = [...pending.values()]
    pending.clear()
    for (const resolve of resolvers) resolve(failure)
  }

  function clearScene(): void {
    socket = undefined
    sessionId = undefined
    cachedSchema = undefined
  }

  function teardown(ws: WebSocket): void {
    if (socket !== ws) return
    clearScene()
    failPending(sceneUnavailable())
  }

  function handleWireMessage(raw: string): void {
    let message: SceneWireMessage
    try {
      message = JSON.parse(raw) as SceneWireMessage
    } catch {
      // 无法解析的报文直接忽略,不让对端搞崩桥接
      return
    }
    switch (message.type) {
      case 'hello': {
        sessionId = message.sessionId
        cachedSchema = message.schema
        // 新场景会话 = 新的去重作用域(spec 8.5:同一桥接和场景会话内)
        dedup = new RequestDeduplicator()
        break
      }
      case 'result':
      case 'error': {
        const resolve = pending.get(message.commandId)
        // 未知 commandId:不创建新请求也不崩溃(迟到的/幽灵 result)
        if (resolve === undefined) return
        pending.delete(message.commandId)
        resolve(message.response)
        break
      }
      default:
        // job/cancel 报文在 Task 5 接入,这里忽略
        break
    }
  }

  function rejectSecondConnection(ws: WebSocket): void {
    // 单场景(spec 10.4):第二个活动连接收 INVALID_STATE 后关闭,
    // 不注册 message 处理、不触碰第一连接的任何状态
    const rejection: SceneWireMessage = {
      type: 'error',
      commandId: 'connection',
      response: {
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: '桥接只接受一个活动场景会话',
          retryable: false,
        },
      },
    }
    ws.on('error', () => {}) // 拒绝路径上的 socket 错误不向外抛
    ws.send(JSON.stringify(rejection), () => ws.close())
  }

  wss.on('connection', (ws: WebSocket) => {
    if (socket !== undefined) {
      rejectSecondConnection(ws)
      return
    }
    socket = ws
    ws.on('message', (data) => handleWireMessage(data.toString()))
    ws.on('close', () => teardown(ws))
    ws.on('error', () => teardown(ws))
  })

  function forward(
    ws: WebSocket,
    request: CommandRequest,
  ): Promise<CommandResponse> {
    return new Promise((resolve) => {
      const commandId = randomUUID()
      pending.set(commandId, resolve)
      const message: SceneWireMessage = {type: 'command', commandId, request}
      ws.send(JSON.stringify(message), (error) => {
        // 发送失败说明连接正在死亡;close/error 事件负责其余 pending。
        // 注意 ws 成功时回调参数是 null 而不是 undefined,必须用真值判断
        if (error && pending.delete(commandId)) {
          resolve(sceneUnavailable())
        }
      })
    })
  }

  return {
    health(): SceneHealth {
      return socket !== undefined && sessionId !== undefined
        ? {scene: 'connected', sessionId}
        : {scene: 'unavailable'}
    },
    schema(): unknown {
      return cachedSchema
    },
    execute(request: CommandRequest): Promise<CommandResponse> {
      const ws = socket
      if (ws === undefined || sessionId === undefined) {
        return Promise.resolve(sceneUnavailable())
      }
      // query 不进长期去重缓存;未知命令按写命令处理(浏览器回
      // COMMAND_NOT_FOUND),失败结果同样按第一次结果返回
      if (isQueryCommand(cachedSchema, request.name)) {
        return forward(ws, request)
      }
      return dedup.execute(request, () => forward(ws, request))
    },
    attachUpgrade(req: IncomingMessage, socket_: Duplex, head: Buffer): void {
      wss.handleUpgrade(req, socket_, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    },
    close(): Promise<void> {
      clearScene()
      failPending(sceneUnavailable())
      // wss.close 在 noServer 模式下等全部 client 关闭后才回调;
      // terminate 触发 close 事件,此时 socket 已清,teardown 为 no-op
      for (const client of wss.clients) client.terminate()
      return new Promise((resolve) => {
        wss.close(() => resolve())
      })
    },
  }
}
