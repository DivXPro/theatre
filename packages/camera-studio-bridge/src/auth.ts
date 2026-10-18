/**
 * HTTP 与 WebSocket upgrade 共用的鉴权(spec 第 4、10.4 节)。
 *
 * - 普通 HTTP 请求从 `Authorization: Bearer <token>` 取凭据;
 * - WebSocket upgrade 从 subprotocol 中取凭据:`camera-studio-v1` 是
 *   协议标识,不是凭据;凭据在 `token.<encoded>` 中(encoded 为
 *   encodeURIComponent 后的 token);
 * - token 与 authenticate 同时配置时采用 AND 组合(config.ts 已保证
 *   至少存在一项);authenticate 抛异常按拒绝处理;
 * - token 比对使用 constant-time 比较,避免计时侧信道;
 * - token 绝不出现在日志/错误信息中,本模块不打印任何内容。
 */

import {timingSafeEqual} from 'crypto'
import type {IncomingMessage} from 'http'
import type {ResolvedBridgeConfig} from './config'

/** 浏览器页面连接桥接时的 WebSocket 协议标识(不是凭据) */
export const BRIDGE_WS_PROTOCOL = 'camera-studio-v1'
const TOKEN_SUBPROTOCOL_PREFIX = 'token.'

function isUpgradeRequest(req: IncomingMessage): boolean {
  const upgrade = req.headers.upgrade
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket'
}

/** 从 Authorization 头取 Bearer 凭据;非 Bearer scheme 一律无凭据(401) */
export function extractBearerCredential(
  req: IncomingMessage,
): string | undefined {
  const header = req.headers.authorization
  if (header === undefined) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1] : undefined
}

/**
 * 从 upgrade 请求的 subprotocol 列表取凭据:跳过协议标识
 * `camera-studio-v1`,只认 `token.<encoded>` 项;解码失败视为无凭据。
 */
export function extractUpgradeCredential(
  req: IncomingMessage,
): string | undefined {
  const header = req.headers['sec-websocket-protocol']
  if (header === undefined) return undefined
  for (const entry of header.split(',')) {
    const protocol = entry.trim()
    if (protocol === BRIDGE_WS_PROTOCOL) continue
    if (protocol.startsWith(TOKEN_SUBPROTOCOL_PREFIX)) {
      const encoded = protocol.slice(TOKEN_SUBPROTOCOL_PREFIX.length)
      if (encoded === '') return undefined
      try {
        return decodeURIComponent(encoded)
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** 按传输方式取凭据:upgrade 走 subprotocol,普通 HTTP 走 Authorization */
export function extractCredential(req: IncomingMessage): string | undefined {
  return isUpgradeRequest(req)
    ? extractUpgradeCredential(req)
    : extractBearerCredential(req)
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * HTTP `/v1` 路由与 WebSocket upgrade 共用的唯一鉴权入口。
 * 只返回是否通过,不回显任何凭据内容。
 */
export async function authorizeRequest(
  req: IncomingMessage,
  config: ResolvedBridgeConfig,
): Promise<boolean> {
  if (config.token !== undefined) {
    const credential = extractCredential(req)
    if (credential === undefined || !tokenMatches(credential, config.token)) {
      return false
    }
  }
  if (config.authenticate !== undefined) {
    let passed: boolean
    try {
      passed = await config.authenticate(req)
    } catch {
      // 宿主校验回调抛异常按拒绝处理,不把异常内容透出
      passed = false
    }
    if (!passed) return false
  }
  return true
}
