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

/** 请求退出当前会话;监听者没清会话时兜底清掉,防状态卡死。
 *  try/finally:监听抛异常(如 capturePose 失败)也兜底清理,异常照常上抛 */
export function requestPoseExit(): void {
  if (!session) return
  // 先快照 key:监听者可能在回调里清会话,循环里再读 session.key 会崩
  const key = session.key
  try {
    for (const cb of exitListeners) cb(key)
  } finally {
    if (session) clearPoseSession()
  }
}

/** 会话唯一:已在摆别的模型时,先按退出流程提交旧会话再开新的 */
export function enterPoseSession(key: string): void {
  if (session?.key === key) return
  if (session) requestPoseExit()
  session = {key}
  emitChange()
}

// —— 退出提交的脏标记 ——

/** 会话脏标记:用户在会话里按下过指针(可能拖了控制点)即为脏。
 *  退出提交门控读它:空进空出不写 poseOverride、不产生幻影撤销步
 *  (对齐 modalGrab 的 moved 语义)。
 *  threeIK 的 isDragging 只能覆盖完整帧间隙的拖动;同帧间隙内按下-拖-松
 *  (帧没跑、骨骼没动)也会被这里的按下事件记脏——多提交无害,漏提交才是 bug。 */
let poseDirty = false

/** PoseModeRig 的 canvas pointerdown 监听调用:按下即记脏(见上)。
 *  无会话不记:清会话后、监听卸载前的窗口期按下不污染下一个会话 */
export function markPoseDirty(): void {
  if (!session) return
  poseDirty = true
}

/** 退出提交门控读;clearPoseSession 时已随会话清零 */
export function isPoseDirty(): boolean {
  return poseDirty
}

/** PoseModeRig 卸载清理用:按键清会话——只清自己的。
 *  A→B 直接切换时 enterPoseSession('B') 先同步落 session,A 的 rig 后卸载,
 *  无条件的 clearPoseSession 会把 B 的新会话抹掉(切换坍塌) */
export function clearPoseSessionIfCurrent(key: string): void {
  if (session?.key === key) clearPoseSession()
}

export function clearPoseSession(): void {
  if (!session) return
  session = null
  poseDirty = false
  emitChange()
}

// —— 操纵器模式(姿势会话内 W/E 键 / 浮动小条按钮共用)——

export type PoseManipulatorMode = 'move' | 'rotate'

/** 记住偏好:不随 clearPoseSession 清零,下次进入沿用上次的(Maya 习惯) */
let manipulatorMode: PoseManipulatorMode = 'move'
const modeListeners = new Set<(m: PoseManipulatorMode) => void>()

export function getPoseManipulatorMode(): PoseManipulatorMode {
  return manipulatorMode
}

export function setPoseManipulatorMode(m: PoseManipulatorMode): void {
  if (m === manipulatorMode) return
  manipulatorMode = m
  for (const cb of modeListeners) cb(m)
}

/** PoseModeRig 订阅(转发 threeIK)与浮动小条订阅(高亮当前模式) */
export function onPoseManipulatorModeChange(
  cb: (m: PoseManipulatorMode) => void,
): () => void {
  modeListeners.add(cb)
  return () => {
    modeListeners.delete(cb)
  }
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
