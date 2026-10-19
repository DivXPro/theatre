/**
 * 程序化桥接入口(spec 10.3,Task 7):组合 config、FileStore、JobStore、
 * SceneSession 与 HTTP server,返回 `{origin, port, close()}`。
 *
 * 本模块只做装配与生命周期,不含任何领域逻辑:
 * - `port: 0` 表示由系统分配临时端口,返回值携带实际端口与 origin
 *   (resolveBridgeConfig 只收 1..65535,0 在进入归一化前单独处理);
 * - JobStore 的取消转发出口经闭包延迟读取 SceneSession.execute,
 *   解开 session(需要 jobs)与 jobs(需要 execute)的构造环;
 * - `close()` 幂等:先终止 WebSocket 场景会话(升级连接不受
 *   server.close 追踪,必须先 terminate),再关 HTTP(强制断开
 *   keep-alive 连接),最后清 FileStore(停 sweep timer、删临时目录)。
 *
 * Token 绝不出现在日志/返回值中;本模块不打印任何内容。
 */

import type {Server} from 'http'
import type {AddressInfo} from 'net'
import {resolveBridgeConfig} from './config'
import {createFileStore} from './FileStore'
import {createJobStore} from './JobStore'
import type {SceneSession} from './SceneSession'
import {createSceneSession} from './SceneSession'
import {createHttpServer} from './httpServer'
import type {CameraStudioBridgeConfig} from './types'

/** 运行中的桥接句柄(createCameraStudioBridge 的返回值) */
export type CameraStudioBridge = {
  /** 实际 HTTP origin,如 `http://127.0.0.1:43110`(port 0 时为实际端口) */
  readonly origin: string
  /** 实际监听端口 */
  readonly port: number
  /** 幂等关停:场景会话、HTTP server、任务投影与临时文件全部清理 */
  close(): Promise<void>
}

/** host 含冒号(IPv6)时 origin 需要括号 */
function originFor(host: string, port: number): string {
  const printableHost = host.includes(':') ? `[${host}]` : host
  return `http://${printableHost}:${port}`
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function createCameraStudioBridge(
  config: CameraStudioBridgeConfig,
): Promise<CameraStudioBridge> {
  // port 0 = 系统分配临时端口;resolveBridgeConfig 只收 1..65535,
  // 这里把 0 归一为"缺省"(只影响归一化值,实际监听用 0)
  const ephemeral = config.port === 0
  const resolved = resolveBridgeConfig(
    ephemeral ? {...config, port: undefined} : config,
  )
  const listenPort = ephemeral ? 0 : resolved.port

  const files = createFileStore({
    maxUploadBytes: resolved.maxUploadBytes,
    fileTtlMs: resolved.fileTtlMs,
  })
  // 构造环:session 需要 jobs(job 事件投影),jobs 需要 execute(取消转发)。
  // execute 经闭包延迟读取 session,赋值在 listen 之前完成,不会被提前调用。
  let session: SceneSession
  const jobs = createJobStore({
    execute: (request) => session.execute(request),
  })
  session = createSceneSession({jobs})
  const server = createHttpServer({config: resolved, session, files, jobs})

  try {
    await listen(server, listenPort, resolved.host)
  } catch (error) {
    // 监听失败(如端口占用):已创建的资源全部清理,不留 timer/临时目录
    await session.close().catch(() => {})
    await files.close().catch(() => {})
    throw error
  }

  const {port} = server.address() as AddressInfo
  const origin = originFor(resolved.host, port)

  let closing: Promise<void> | undefined
  function close(): Promise<void> {
    if (closing === undefined) {
      closing = (async () => {
        // 先终止场景会话:ws 升级连接不受 server.close 追踪
        await session.close()
        // 强制断开活跃/keep-alive HTTP 连接(node >= 18.2;
        // 更早版本无此方法,连接随最后一次响应自然结束)
        const closable = server as Server & {closeAllConnections?: () => void}
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
          closable.closeAllConnections?.()
        })
        await files.close()
      })()
      // 关停失败不阻断重试语义:幂等指"多次调用同一 Promise"
      closing.catch(() => {})
    }
    return closing
  }

  return {origin, port, close}
}
