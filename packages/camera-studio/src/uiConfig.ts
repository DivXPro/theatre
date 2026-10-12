/**
 * UI 装配可配层(spec §3 ui 字段 / §7 约束):停靠框 portal 容器 /
 * z-index 基准 / 语言。模块级单值,bootstrap 在 boot 时一次写入
 * (config.ui ?? 空对象);boot 级保留语义与 R14 一致——dispose 不复位,
 * 重挂幂等复用。缺省 = 现状:portal → document.body、zIndexBase 1000。
 */

/** UI 装配(spec §3 ui 字段):停靠框 portal 容器 / z-index 基准 / 语言 */
type UiConfig = {
  portalContainer?: HTMLElement
  zIndexBase?: number
  locale?: string
}
let current: UiConfig = {}
export function setUiConfig(cfg: UiConfig): void {
  current = cfg
}
export function getUiConfig(): Required<Pick<UiConfig, 'zIndexBase'>> &
  UiConfig {
  return {zIndexBase: 1000, ...current}
}
