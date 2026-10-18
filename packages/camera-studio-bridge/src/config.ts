/**
 * 桥接安全配置解析(spec 第 4、10.3、10.4 节)。
 *
 * 安全基线:
 * - 默认仅本机监听(host 127.0.0.1、port 43110)、无 CORS 放行;
 * - 没有任何鉴权配置(token 与 authenticate 都缺失)时拒绝启动;
 * - host 改为公网/局域网地址不会放松鉴权要求(仍需显式凭据);
 * - token 与 authenticate 同时存在时采用 AND 组合,两项都必须通过,
 *   不允许组合配置反而降低安全。
 *
 * Token 绝不出现在 stdout/stderr/日志/文档真实值中;本模块只做校验与
 * 归一化,不打印任何配置内容。
 */

import type {BridgeAuth, CameraStudioBridgeConfig} from './types'

/** 鉴权组合方式:仅 token、仅自定义回调、或两者 AND 组合 */
export type BridgeAuthMode = 'token' | 'custom' | 'token+custom'

/** 归一化后的桥接配置(resolveBridgeConfig 的返回值,已冻结) */
export type ResolvedBridgeConfig = {
  host: string
  port: number
  corsOrigins: readonly string[]
  maxUploadBytes: number
  maxCommandBytes: number
  fileTtlMs: number
  token?: string
  authenticate?: BridgeAuth['authenticate']
  authMode: BridgeAuthMode
}

export const BRIDGE_DEFAULT_PORT = 43110
export const BRIDGE_DEFAULT_HOST = '127.0.0.1'
export const BRIDGE_DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
export const BRIDGE_DEFAULT_MAX_COMMAND_BYTES = 1024 * 1024
export const BRIDGE_DEFAULT_FILE_TTL_MS = 60 * 60 * 1000

function fail(message: string): never {
  throw new Error(`camera-studio-bridge config: ${message}`)
}

function resolvePort(port: number | undefined): number {
  if (port === undefined) return BRIDGE_DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`invalid port ${String(port)}; expected an integer in 1..65535`)
  }
  return port
}

function resolvePositiveInt(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer, got ${String(value)}`)
  }
  return value
}

function resolveCorsOrigins(origins: string[] | undefined): readonly string[] {
  if (origins === undefined) return Object.freeze([])
  const seen = new Set<string>()
  const resolved = origins.map((raw) => {
    const origin = raw.trim()
    if (origin === '') {
      fail('corsOrigins must not contain empty origins')
    }
    if (seen.has(origin)) {
      fail(`corsOrigins contains duplicate origin "${origin}"`)
    }
    seen.add(origin)
    return origin
  })
  return Object.freeze(resolved)
}

function resolveAuth(config: CameraStudioBridgeConfig): {
  token?: string
  authenticate?: BridgeAuth['authenticate']
  authMode: BridgeAuthMode
} {
  const token = config.token !== undefined ? config.token.trim() : undefined
  const hasToken = token !== undefined && token !== ''
  const authenticate = config.authenticate
  if (!hasToken && !authenticate) {
    fail(
      'no authentication configured: provide a Bearer Token or an ' +
        'authenticate callback; refusing to start without authentication',
    )
  }
  const authMode: BridgeAuthMode = hasToken
    ? authenticate
      ? 'token+custom'
      : 'token'
    : 'custom'
  return {
    token: hasToken ? token : undefined,
    authenticate,
    authMode,
  }
}

/**
 * 归一化并冻结桥接配置。
 *
 * 只有 token 时,HTTP 与 WebSocket upgrade 使用默认 Bearer/subprotocol
 * 校验;只有 authenticate 时,该回调同时负责 HTTP 与 upgrade,并自行从
 * header/subprotocol 取凭据;两者同时存在时两项都必须通过(AND)。
 * 浏览器桥接客户端的凭据始终由宿主显式注入。
 */
export function resolveBridgeConfig(
  config: CameraStudioBridgeConfig,
): ResolvedBridgeConfig {
  const host = config.host?.trim() || BRIDGE_DEFAULT_HOST
  const auth = resolveAuth(config)
  return Object.freeze({
    host,
    port: resolvePort(config.port),
    corsOrigins: resolveCorsOrigins(config.corsOrigins),
    maxUploadBytes: resolvePositiveInt(
      config.maxUploadBytes,
      BRIDGE_DEFAULT_MAX_UPLOAD_BYTES,
      'maxUploadBytes',
    ),
    maxCommandBytes: resolvePositiveInt(
      config.maxCommandBytes,
      BRIDGE_DEFAULT_MAX_COMMAND_BYTES,
      'maxCommandBytes',
    ),
    fileTtlMs: resolvePositiveInt(
      config.fileTtlMs,
      BRIDGE_DEFAULT_FILE_TTL_MS,
      'fileTtlMs',
    ),
    token: auth.token,
    authenticate: auth.authenticate,
    authMode: auth.authMode,
  })
}

type EnvSource = Record<string, string | undefined>

function parseEnvInt(raw: string, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    fail(`environment variable ${name} must be an integer, got "${raw}"`)
  }
  return value
}

/**
 * 从环境变量读取桥接配置(命令行/部署入口):
 * CAMERA_STUDIO_BRIDGE_HOST / PORT / TOKEN / CORS_ORIGINS / MAX_UPLOAD_BYTES。
 * 环境变量无法表达 authenticate 回调;两者同时配置由程序化入口完成。
 * CORS_ORIGINS 为逗号分隔列表;空段与重复项与程序化配置一样被拒绝。
 */
export function resolveBridgeConfigFromEnv(
  env: EnvSource = process.env,
): ResolvedBridgeConfig {
  const config: CameraStudioBridgeConfig = {}
  const host = env.CAMERA_STUDIO_BRIDGE_HOST
  if (host !== undefined && host.trim() !== '') config.host = host
  const port = env.CAMERA_STUDIO_BRIDGE_PORT
  if (port !== undefined && port.trim() !== '') {
    config.port = parseEnvInt(port.trim(), 'CAMERA_STUDIO_BRIDGE_PORT')
  }
  const token = env.CAMERA_STUDIO_BRIDGE_TOKEN
  if (token !== undefined && token !== '') config.token = token
  const cors = env.CAMERA_STUDIO_BRIDGE_CORS_ORIGINS
  if (cors !== undefined && cors.trim() !== '') {
    // 保留空段(如 "a,,b"),交由 resolveBridgeConfig 统一拒绝空 origin
    config.corsOrigins = cors.split(',')
  }
  const maxUpload = env.CAMERA_STUDIO_BRIDGE_MAX_UPLOAD_BYTES
  if (maxUpload !== undefined && maxUpload.trim() !== '') {
    config.maxUploadBytes = parseEnvInt(
      maxUpload.trim(),
      'CAMERA_STUDIO_BRIDGE_MAX_UPLOAD_BYTES',
    )
  }
  return resolveBridgeConfig(config)
}
