#!/usr/bin/env node
/**
 * `camera-studio-bridge` 命令行入口(spec 10.3,Task 7)。
 *
 * 安全约束:
 * - token 只从 `--token-env` 指定的环境变量读取(默认
 *   CAMERA_STUDIO_BRIDGE_TOKEN),绝不接受命令行直传,绝不打印;
 * - 只打印实际 origin 与场景连接状态(connected/unavailable + sessionId);
 * - SIGINT/SIGTERM 触发幂等 close(场景会话、HTTP、临时文件全部清理)。
 *
 * 参数(`--flag value` 与 `--flag=value` 均可,重复时 host/port/token-env
 * 后值覆盖,cors-origin 累积):
 *   --host <host>          监听地址(默认 127.0.0.1)
 *   --port <port>          监听端口,0 = 系统分配(默认 43110)
 *   --token-env <name>     token 来源环境变量名
 *   --cors-origin <origin> 放行一个 CORS 来源(可重复;缺省不放行任何来源)
 *   --help                 打印用法
 *
 * runBridgeCli 接受注入的 env/print/onSignal,供测试与程序化宿主复用;
 * 进程信号接线只在经 main 启动(直接 node dist/cli.js)时走 process.once。
 */

import http from 'http'
import type {CameraStudioBridge} from './bridge'
import {createCameraStudioBridge} from './bridge'

/** token 来源环境变量的默认名(与 config.ts 的 env 入口一致) */
export const DEFAULT_TOKEN_ENV = 'CAMERA_STUDIO_BRIDGE_TOKEN'

export const BRIDGE_CLI_USAGE = `用法: camera-studio-bridge [选项]
  --host <host>          监听地址(默认 127.0.0.1)
  --port <port>          监听端口,0 = 系统分配(默认 43110)
  --token-env <name>     token 来源环境变量名(默认 ${DEFAULT_TOKEN_ENV})
  --cors-origin <origin> 放行一个 CORS 来源(可重复)
  --help                 打印本用法
token 只从指定环境变量读取,绝不接受命令行直传。`

export type BridgeCliOptions = {
  host?: string
  port?: number
  tokenEnv: string
  corsOrigins: string[]
  help: boolean
}

/** 命令行用法错误(退出码 2;区别于运行时失败的 1) */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

export function parseBridgeCliArgs(argv: string[]): BridgeCliOptions {
  const options: BridgeCliOptions = {
    tokenEnv: DEFAULT_TOKEN_ENV,
    corsOrigins: [],
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    let inlineValue: string | undefined
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq > 2) {
      inlineValue = arg.slice(eq + 1)
      arg = arg.slice(0, eq)
    }
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue
      const value = argv[i + 1]
      if (value === undefined) {
        throw new CliUsageError(`${arg} 缺少值`)
      }
      i += 1
      return value
    }
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--host':
        options.host = takeValue()
        break
      case '--port': {
        const raw = takeValue()
        const port = Number(raw)
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new CliUsageError(`--port 必须是 0..65535 的整数,收到 "${raw}"`)
        }
        options.port = port
        break
      }
      case '--token-env':
        options.tokenEnv = takeValue()
        break
      case '--cors-origin':
        options.corsOrigins.push(takeValue())
        break
      default:
        throw new CliUsageError(`未知参数: ${arg}`)
    }
  }
  return options
}

export type BridgeCliIo = {
  /** 环境变量来源;默认 process.env */
  env?: Record<string, string | undefined>
  /** 输出行出口;默认 stdout。token 绝不经过这里 */
  print?: (line: string) => void
  /** 信号注册出口;默认 process.once */
  onSignal?: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void
  /** 场景状态轮询间隔;默认 500ms,测试可缩小 */
  healthPollMs?: number
}

export type RunningBridgeCli = {
  /** 实际 origin(含实际端口) */
  readonly origin: string
  /** 幂等关停(含信号处理器触发的关停) */
  close(): Promise<void>
}

/** health 轮询读取(走桥接公开表面,token 只在 Authorization 头里) */
function fetchHealth(
  origin: string,
  token: string,
): Promise<{scene: string; sessionId?: string}> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${origin}/v1/health`,
      {agent: false, headers: {Authorization: `Bearer ${token}`}},
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as any
            resolve({
              scene:
                body?.result?.scene === 'connected'
                  ? 'connected'
                  : 'unavailable',
              sessionId:
                typeof body?.result?.sessionId === 'string'
                  ? body.result.sessionId
                  : undefined,
            })
          } catch (error) {
            reject(error as Error)
          }
        })
      },
    )
    req.on('error', reject)
  })
}

/**
 * 解析参数并启动桥接;`--help` 打印用法后返回 undefined。
 * token 只从 `options.tokenEnv` 指定的环境变量读取;缺失/为空时抛错,
 * 错误信息只含变量名,绝不含 token 值。
 */
export async function runBridgeCli(
  argv: string[],
  io: BridgeCliIo = {},
): Promise<RunningBridgeCli | undefined> {
  const options = parseBridgeCliArgs(argv)
  const env = io.env ?? process.env
  const print =
    io.print ?? ((line: string) => process.stdout.write(`${line}\n`))
  if (options.help) {
    print(BRIDGE_CLI_USAGE)
    return undefined
  }
  const token = env[options.tokenEnv]
  if (token === undefined || token.trim() === '') {
    throw new CliUsageError(
      `环境变量 ${options.tokenEnv} 未设置或为空:桥接拒绝在无鉴权凭据时启动;` +
        `请把 token 放入该环境变量(切勿经命令行参数传递)`,
    )
  }

  const bridge: CameraStudioBridge = await createCameraStudioBridge({
    ...(options.host !== undefined ? {host: options.host} : {}),
    ...(options.port !== undefined ? {port: options.port} : {}),
    token,
    corsOrigins: options.corsOrigins,
  })
  print(`camera-studio-bridge listening: ${bridge.origin}`)

  // 场景连接状态:轮询 /v1/health,只在状态翻转时打印
  let lastScene: string | undefined
  let stopped = false
  const poll = async (): Promise<void> => {
    if (stopped) return
    try {
      const health = await fetchHealth(bridge.origin, token)
      if (health.scene !== lastScene) {
        lastScene = health.scene
        print(
          health.scene === 'connected'
            ? `scene: connected (sessionId ${health.sessionId ?? 'unknown'})`
            : 'scene: unavailable(等待浏览器场景连接)',
        )
      }
    } catch {
      /* 关停途中或瞬时失败:忽略,下一轮再试 */
    }
  }
  const timer = setInterval(() => {
    void poll()
  }, io.healthPollMs ?? 500)
  void poll()

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing === undefined) {
      stopped = true
      clearInterval(timer)
      closing = bridge.close()
    }
    return closing
  }

  const onSignal =
    io.onSignal ??
    ((signal: 'SIGINT' | 'SIGTERM', handler: () => void) => {
      process.once(signal, handler)
    })
  const shutdown = (): void => {
    void close()
  }
  onSignal('SIGINT', shutdown)
  onSignal('SIGTERM', shutdown)

  return {origin: bridge.origin, close}
}

async function main(): Promise<void> {
  try {
    const running = await runBridgeCli(process.argv.slice(2))
    if (running === undefined) return // --help
    // 进程存活由 HTTP server 与轮询 timer 维持;SIGINT/SIGTERM 已由
    // runBridgeCli 默认接线到 close(),资源清理后事件循环排空自然退出
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`camera-studio-bridge: ${message}\n`)
    if (error instanceof CliUsageError) {
      process.stderr.write(`${BRIDGE_CLI_USAGE}\n`)
      process.exitCode = 2
    } else {
      process.exitCode = 1
    }
  }
}

/* 直接执行(node dist/cli.js)时才启动;jest/程序化 import 不触发 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (typeof require !== 'undefined' && require.main === module) {
  void main()
}
