// packages/camera-studio/src/poseMode/poseSession.test.ts
import {
  enterPoseSession,
  getPoseSession,
  clearPoseSession,
  clearPoseSessionIfCurrent,
  requestPoseExit,
  onPoseSessionChange,
  onPoseExitRequested,
  noteModelDoubleClick,
  isModelDoubleClick,
  setPoseHitTester,
  poseHitTest,
  markPoseDirty,
  isPoseDirty,
  getPoseManipulatorMode,
  setPoseManipulatorMode,
  onPoseManipulatorModeChange,
  setPoseSessionFrame,
  getPoseSessionFrame,
} from './poseSession'

beforeEach(() => {
  clearPoseSession()
  setPoseHitTester(null)
})

test('进入会话后 getPoseSession 返回该模型;清空后回到 null', () => {
  expect(getPoseSession()).toBeNull()
  enterPoseSession('m1')
  expect(getPoseSession()).toEqual({key: 'm1'})
  clearPoseSession()
  expect(getPoseSession()).toBeNull()
})

test('会话唯一:已进入 A 再进入 B,先对 A 发退出请求再切到 B', () => {
  const exited: string[] = []
  const off = onPoseExitRequested((key) => {
    exited.push(key)
    clearPoseSession() // 仿 PoseModeRig:提交后清会话
  })
  enterPoseSession('A')
  enterPoseSession('B')
  expect(exited).toEqual(['A'])
  expect(getPoseSession()).toEqual({key: 'B'})
  off()
})

test('重复进入同一会话是空操作,不发退出请求', () => {
  const exited: string[] = []
  onPoseExitRequested((key) => exited.push(key))
  enterPoseSession('A')
  enterPoseSession('A')
  expect(exited).toEqual([])
  expect(getPoseSession()).toEqual({key: 'A'})
})

test('requestPoseExit 通知监听者;监听者没清会话时兜底清掉', () => {
  const exited: string[] = []
  enterPoseSession('A')
  const off = onPoseExitRequested((key) => exited.push(key))
  requestPoseExit()
  expect(exited).toEqual(['A'])
  expect(getPoseSession()).toBeNull() // 监听者没调 clear,模块兜底
  off()
})

test('无会话时 requestPoseExit 空操作', () => {
  const exited: string[] = []
  onPoseExitRequested((key) => exited.push(key))
  requestPoseExit()
  expect(exited).toEqual([])
})

test('onPoseSessionChange 订阅进出', () => {
  const seen: Array<{key: string} | null> = []
  onPoseSessionChange((s) => seen.push(s))
  enterPoseSession('A')
  clearPoseSession()
  expect(seen).toEqual([{key: 'A'}, null])
})

test('双击判定:记录模型的双击 timeStamp 后判定命中', () => {
  expect(isModelDoubleClick(111)).toBe(false)
  noteModelDoubleClick(111)
  expect(isModelDoubleClick(111)).toBe(true)
  expect(isModelDoubleClick(222)).toBe(false)
})

test('命中测试:注册后代理调用,null 时恒 false', () => {
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(false)
  setPoseHitTester(() => true)
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(true)
  setPoseHitTester(null)
  expect(poseHitTest({clientX: 1, clientY: 2})).toBe(false)
})

test('markPoseDirty 与 isDragging 轮询双通道或语义:任一通道记脏即提交', () => {
  // 同帧间隙拖动(帧没跑,isDragging 轮询漏检)由按下事件兜底记脏
  enterPoseSession('k')
  expect(isPoseDirty()).toBe(false)
  markPoseDirty() // pointerdown 监听在帧外调用
  expect(isPoseDirty()).toBe(true)
  // 门控读后照常清理
  clearPoseSession()
  expect(isPoseDirty()).toBe(false)
})

test('脏标记随 clearPoseSession 清零(requestPoseExit 兜底清理同样生效)', () => {
  enterPoseSession('k')
  markPoseDirty()
  expect(isPoseDirty()).toBe(true)
  requestPoseExit() // 无监听者,模块兜底 clearPoseSession
  expect(getPoseSession()).toBeNull()
  expect(isPoseDirty()).toBe(false)
})

test('clearPoseSessionIfCurrent:A→B 切换时 A 的卸载清理不能把 B 的新会话抹掉', () => {
  // 镜像组件生命周期:enter(A) → enter(B)(A 的 rig 随后卸载,清理按键清)
  enterPoseSession('A')
  enterPoseSession('B')
  clearPoseSessionIfCurrent('A') // A 的 PoseModeRig 卸载清理
  expect(getPoseSession()).toEqual({key: 'B'}) // B 的会话必须存活
  clearPoseSessionIfCurrent('B') // B 自己卸载时才清得掉
  expect(getPoseSession()).toBeNull()
})

test('clearPoseSessionIfCurrent:无会话时安全空操作', () => {
  clearPoseSessionIfCurrent('A') // 不抛即可
  expect(getPoseSession()).toBeNull()
})

test('无会话时 markPoseDirty 不记脏(清理窗口期的按下不污染下一个会话)', () => {
  markPoseDirty() // 会话已清、监听未卸的窗口期按下
  expect(isPoseDirty()).toBe(false)
  enterPoseSession('k') // 下一个会话进来是干净的
  expect(isPoseDirty()).toBe(false)
  markPoseDirty() // 会话中的按下才记脏
  expect(isPoseDirty()).toBe(true)
})

test('requestPoseExit:监听抛异常也兜底清会话(异常照常上抛)', () => {
  enterPoseSession('k')
  const off = onPoseExitRequested(() => {
    throw new Error('listener boom')
  })
  expect(() => requestPoseExit()).toThrow('listener boom')
  expect(getPoseSession()).toBeNull() // 不卡死
  off()
})

// —— 操纵器模式(浮动小条与 W/E 键共用)——

test('操纵器模式默认 move', () => {
  expect(getPoseManipulatorMode()).toBe('move')
})

test('setPoseManipulatorMode 切换并通知订阅;重复设同值不重复通知', () => {
  const seen: string[] = []
  const off = onPoseManipulatorModeChange((m) => seen.push(m))
  setPoseManipulatorMode('rotate')
  expect(getPoseManipulatorMode()).toBe('rotate')
  setPoseManipulatorMode('rotate') // 同值去重
  setPoseManipulatorMode('move')
  expect(seen).toEqual(['rotate', 'move'])
  off()
})

test('操纵器模式记住偏好:清会话/退出都不重置', () => {
  setPoseManipulatorMode('rotate')
  enterPoseSession('k')
  clearPoseSession()
  expect(getPoseManipulatorMode()).toBe('rotate') // 下次进入沿用上次的
  setPoseManipulatorMode('move') // 复原,免得影响后面的用例
})

test('onPoseManipulatorModeChange 退订后不再收到', () => {
  const seen: string[] = []
  const off = onPoseManipulatorModeChange((m) => seen.push(m))
  off()
  setPoseManipulatorMode('rotate')
  expect(seen).toEqual([])
  setPoseManipulatorMode('move')
})

// —— 会话帧信息(帧模式:帧上=编辑/帧间=新建,随会话生灭)——

test('会话帧信息随会话生灭:set/get/clear', () => {
  enterPoseSession('k1')
  setPoseSessionFrame('k1', {mode: 'edit', position: 2})
  expect(getPoseSessionFrame()).toEqual({mode: 'edit', position: 2})
  clearPoseSession()
  expect(getPoseSessionFrame()).toBe(null)
})

test('非当前会话 key 写入帧信息被忽略(A→B 切换防护)', () => {
  enterPoseSession('kB')
  setPoseSessionFrame('kA', {mode: 'edit', position: 2})
  expect(getPoseSessionFrame()).toBe(null)
  clearPoseSession()
})
