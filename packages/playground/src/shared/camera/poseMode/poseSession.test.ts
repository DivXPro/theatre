// packages/playground/src/shared/camera/poseMode/poseSession.test.ts
import {
  enterPoseSession,
  getPoseSession,
  clearPoseSession,
  requestPoseExit,
  onPoseSessionChange,
  onPoseExitRequested,
  noteModelDoubleClick,
  isModelDoubleClick,
  setPoseHitTester,
  poseHitTest,
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
  onPoseExitRequested((key) => {
    exited.push(key)
    clearPoseSession() // 仿 PoseModeRig:提交后清会话
  })
  enterPoseSession('A')
  enterPoseSession('B')
  expect(exited).toEqual(['A'])
  expect(getPoseSession()).toEqual({key: 'B'})
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
