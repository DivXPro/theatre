/**
 * 动画资源加载状态登记(2026-10-17,Task 9):PlacementManager 的动画加载
 * effect 在加载开始/成功/失败时按 placement key 登记,React cleanup
 * (卸载或 animationId 切换)必须删除对应 key——`animations.getStatus`
 * 只读这里的登记,绝不从 props 猜测 loaded(未挂载即无登记,查询方按
 * 「加载中」如实上报,不留陈旧 loaded)。
 *
 * 模块级表与 objectRuntime/placementLifecycle 同模式:单页单场景。
 */
import type {AgentErrorDto} from '../types'

/** 某放置模型当前的动画加载状态 */
export type AnimationLoadStatus = {
  /** 正在加载/已加载/失败的动画资产 id */
  assetId: string
  loaded: boolean
  /** 加载失败的结构化错误;成功/进行中缺省 */
  error?: AgentErrorDto
}

const statuses = new Map<string, AnimationLoadStatus>()

/** PlacementManager 动画加载 effect 调用:开始(loaded:false)/成功/失败 */
export function setAnimationLoadStatus(
  key: string,
  status: AnimationLoadStatus,
): void {
  statuses.set(key, status)
}

/** React cleanup 必须调用:卸载或切换动画后不得残留陈旧状态 */
export function clearAnimationLoadStatus(key: string): void {
  statuses.delete(key)
}

/** animations.getStatus 读取;未登记为 undefined(调用方按加载中处理) */
export function getAnimationLoadStatus(
  key: string,
): AnimationLoadStatus | undefined {
  return statuses.get(key)
}
