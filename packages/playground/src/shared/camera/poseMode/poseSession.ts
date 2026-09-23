// packages/playground/src/shared/camera/poseMode/poseSession.ts
/**
 * 姿势会话:哪个模型正在摆姿势(placementKey),全局唯一。
 * App 管进入/退出的触发;PoseModeRig 订阅退出请求,负责提交骨骼写回。
 * 双击空白退出的判定需要两处共享状态:模型双击的 timeStamp 去重、
 * PoseModeRig 注册的命中测试(控制球/被摆模型不算空白)。
 */
import {useEffect, useState} from 'react'

export type PoseSession = {key: string}

let session: PoseSession | null = null
const changeListeners = new Set<(s: PoseSession | null) => void>()
const exitListeners = new Set<(key: string) => void>()

export function getPoseSession(): PoseSession | null {
  return session
}

export function onPoseSessionChange(
  cb: (s: PoseSession | null) => void,
): () => void {
  changeListeners.add(cb)
  return () => {
    changeListeners.delete(cb)
  }
}

/** PoseModeRig 订阅:外部请求退出时回调(提交 + clearPoseSession) */
export function onPoseExitRequested(cb: (key: string) => void): () => void {
  exitListeners.add(cb)
  return () => {
    exitListeners.delete(cb)
  }
}

function emitChange() {
  for (const cb of changeListeners) cb(session)
}

/** 请求退出当前会话;监听者没清会话时兜底清掉,防状态卡死 */
export function requestPoseExit(): void {
  if (!session) return
  // 先快照 key:监听者可能在回调里清会话,循环里再读 session.key 会崩
  const key = session.key
  for (const cb of exitListeners) cb(key)
  if (session) clearPoseSession()
}

/** 会话唯一:已在摆别的模型时,先按退出流程提交旧会话再开新的 */
export function enterPoseSession(key: string): void {
  if (session?.key === key) return
  if (session) requestPoseExit()
  session = {key}
  emitChange()
}

export function clearPoseSession(): void {
  if (!session) return
  session = null
  emitChange()
}

/** React 订阅hook:会话命中的 placementKey,无会话为 null */
export function usePoseSessionKey(): string | null {
  const [key, setKey] = useState<string | null>(getPoseSession()?.key ?? null)
  useEffect(() => onPoseSessionChange((s) => setKey(s?.key ?? null)), [])
  return key
}

// —— 双击空白退出判定的共享状态 ——

let lastModelDblClickAt = -1

/** 模型的 onDoubleClick 第一件事就是记录 timeStamp:落在模型上的双击不算空白 */
export function noteModelDoubleClick(timeStamp: number): void {
  lastModelDblClickAt = timeStamp
}

export function isModelDoubleClick(timeStamp: number): boolean {
  return timeStamp === lastModelDblClickAt
}

let hitTester: ((ev: {clientX: number; clientY: number}) => boolean) | null =
  null

/** PoseModeRig 注册/注销命中测试(被摆模型 + 控制球) */
export function setPoseHitTester(
  fn: ((ev: {clientX: number; clientY: number}) => boolean) | null,
): void {
  hitTester = fn
}

export function poseHitTest(ev: {clientX: number; clientY: number}): boolean {
  return hitTester?.(ev) ?? false
}
