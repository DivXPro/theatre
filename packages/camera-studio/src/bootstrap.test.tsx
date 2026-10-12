/*
 * @jest-environment jsdom
 */
/**
 * bootstrap + useCameraStudio 生命周期契约(任务 8,spec §7;9 用例):
 *   1. 幂等 + StrictMode(init 共享 promise,双跑只 init 一次)
 *   2. 卸载四项清理(编辑器注销 / state 订阅断开 / ui.hide;重挂 ui.restore)
 *   3. 重挂幂等(ready 恢复,init 仍 1 次)
 *   4. 第二实例报错(单页只允许一个)
 *   5. storage namespace(库名 toybox-asset-library[-ns])
 *   6. state 通道(usePersistentStorage:false + 尾部节流 + dispose flush)
 *   7. sync 透传(serverUrl;缺省不带键)
 *   8. storage:false 纯查看器(canWrite=false,init 不碰 indexedDB)
 *   9. 冲突矩阵(宿主已 init:一致静默复用 / 不一致告警以先到为准;未 init 模块 init)
 *
 * jest-esbuild 不提升 jest.mock:全部 doMock 先行登记,jest.resetModules
 * 后运行时 import 被测模块。仓内无 testing-library 依赖(R13):
 * renderHook 用 createRoot + React.act 手写 harness 等价物
 * (与 TopToolbar.test.tsx / App.hostFlows.test.tsx 同一套手法)。
 *
 * 注意:jest.resetModules() 会连 react 一起重置——静态 import 的
 * react/react-dom 与被测模块重置后重新求值的 react 不是同一实例,
 * hooks 的 dispatcher 落空(useRef on null)。故 react/react-dom 也在
 * beforeEach 里动态 import,与被测模块共享同一模块注册表。
 */
import {IDBFactory} from 'fake-indexeddb'
import type {CameraStudioConfig, CameraStudioHandle} from './config'

// React 19 act 的环境开关(testing-library 会自动置,手写 harness 自己置)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// ── 替身盒子(doMock 工厂闭包共享;beforeEach 复位) ─────────────
const initSpy = jest.fn(async (_opts?: unknown) => {})
const getProjectSpy = jest.fn(() => ({fake: true}))
// studio.ui 替身:hide/restore 翻转 isHidden(与真 UI 行为一致;
// bootstrap 仅在 isHidden 时才 restore)
const uiBox = {
  isHidden: false,
  hide: jest.fn(() => {
    uiBox.isHidden = true
  }),
  restore: jest.fn(() => {
    uiBox.isHidden = false
  }),
}
const hideSpy = uiBox.hide
const restoreSpy = uiBox.restore
const stateUnsubSpy = jest.fn()
// onChange(pointer, cb) 的返回值 = 退订函数;state 通道那条订阅的断开断言压它
const onChangeSpy = jest.fn(
  (_pointer: unknown, _cb: (v: unknown) => void) => stateUnsubSpy,
)
const registerSpy = jest.fn()
const unregisterSpy = jest.fn()
/** 模拟 core 的 initState:init 首次调用翻转(与真 core 行为一致) */
const initStateBox: {
  called: boolean
  optsDeferred: {promise: Promise<unknown>}
} = {
  called: false,
  optsDeferred: {promise: new Promise(() => {})},
}
/** 模拟宿主已先行 theatre.init(opts) */
function simulateHostInit(opts: unknown): void {
  initStateBox.called = true
  initStateBox.optsDeferred = {promise: Promise.resolve(opts)}
}
initSpy.mockImplementation(async (opts?: unknown) => {
  if (!initStateBox.called) simulateHostInit(opts)
})

jest.doMock('@dreamerbird/core', () => ({
  __esModule: true,
  default: {init: initSpy},
  getProject: getProjectSpy,
  getStudio: () => ({ui: uiBox}),
  onChange: onChangeSpy,
}))
jest.doMock('@dreamerbird/core/initState', () => ({
  __esModule: true,
  initState: initStateBox,
}))
jest.doMock('@dreamerbird/core/privateAPIs', () => ({
  __esModule: true,
  privateAPI: () => ({pointers: {historic: {fakeHistoricPointer: true}}}),
}))
jest.doMock('@dreamerbird/studio/propEditors/customPropEditors', () => ({
  __esModule: true,
  registerCustomPropEditor: registerSpy,
  unregisterCustomPropEditor: unregisterSpy,
}))
// 编辑器组件替身:注册表认 key 即可,不拉真组件的重依赖链
jest.doMock('./poseMode/PosePropEditor', () => ({
  __esModule: true,
  default: () => null,
}))
jest.doMock('./gesturePropsEditor', () => ({
  __esModule: true,
  GesturePropEditorLeft: () => null,
  GesturePropEditorRight: () => null,
}))

let React: typeof import('react')
let ReactDOM: typeof import('react-dom/client')
let useCameraStudio: typeof import('./useCameraStudio').useCameraStudio
let bootstrap: typeof import('./bootstrap')

beforeEach(async () => {
  // fake-indexeddb 每用例一座新厂(数据隔离);清 localStorage 里的旧播种
  // 清理标记(R7 先例:标记键跨用例共享会污染)
  ;(globalThis as any).indexedDB = new IDBFactory()
  globalThis.localStorage?.clear()
  jest.resetModules()
  initSpy.mockClear()
  getProjectSpy.mockClear()
  hideSpy.mockClear()
  restoreSpy.mockClear()
  stateUnsubSpy.mockClear()
  onChangeSpy.mockClear()
  registerSpy.mockClear()
  unregisterSpy.mockClear()
  initStateBox.called = false
  initStateBox.optsDeferred = {promise: new Promise(() => {})}
  uiBox.isHidden = false
  // react/react-dom 与被测模块同注册表,见文件头注释
  React = await import('react')
  ReactDOM = await import('react-dom/client')
  useCameraStudio = (await import('./useCameraStudio')).useCameraStudio
  bootstrap = await import('./bootstrap')
})

// ── renderHook 等价物(R13:无 testing-library,手写 harness) ────
function hookHost(config?: CameraStudioConfig, opts?: {strict?: boolean}) {
  const {act, StrictMode, createElement} = React
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  const result: {current: CameraStudioHandle | undefined} = {
    current: undefined,
  }
  const Harness = () => {
    result.current = useCameraStudio(config)
    return null
  }
  return {
    result,
    async mount() {
      await act(async () => {
        root.render(
          opts?.strict
            ? createElement(StrictMode, null, createElement(Harness))
            : createElement(Harness),
        )
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      el.remove()
    },
  }
}

/** ui.hide/restore 是 fire-and-forget 微任务链,断言前补一拍冲刷 */
async function flush(): Promise<void> {
  await React.act(async () => {})
}

// 1. 幂等 + StrictMode
test('1. StrictMode 双跑:init 只调一次,编辑器只注册一轮,ready 就位', async () => {
  const h = hookHost({}, {strict: true})
  await h.mount()
  expect(initSpy).toHaveBeenCalledTimes(1)
  // pose/gestureL/gestureR 各一次;双跑不重复注册
  expect(registerSpy).toHaveBeenCalledTimes(3)
  expect(h.result.current?.ready).toBe(true)
  expect(h.result.current?.error).toBeUndefined()
  await h.unmount()
})

// 2. 卸载四项清理
test('2. 卸载:编辑器注销、state 订阅断开、ui.hide;重挂 ui.restore', async () => {
  const h = hookHost({state: {onStateChange: jest.fn()}})
  await h.mount()
  expect(h.result.current?.ready).toBe(true)
  await h.unmount()
  await flush()
  expect(unregisterSpy).toHaveBeenCalledWith('pose')
  expect(unregisterSpy).toHaveBeenCalledWith('gestureL')
  expect(unregisterSpy).toHaveBeenCalledWith('gestureR')
  expect(stateUnsubSpy).toHaveBeenCalledTimes(1)
  expect(hideSpy).toHaveBeenCalledTimes(1)
  // 重挂:ui.restore 被调
  const h2 = hookHost({state: {onStateChange: jest.fn()}})
  await h2.mount()
  await flush()
  expect(restoreSpy).toHaveBeenCalled()
  await h2.unmount()
})

// 3. 重挂幂等
test('3. 重挂幂等:ready 恢复,init 仍 1 次,ui.restore 补调', async () => {
  const h1 = hookHost({})
  await h1.mount()
  expect(h1.result.current?.ready).toBe(true)
  await h1.unmount()
  await flush()
  expect(restoreSpy).not.toHaveBeenCalled() // 首挂本就可见,restore 跳过
  expect(hideSpy).toHaveBeenCalledTimes(1)
  const h2 = hookHost({})
  await h2.mount()
  await flush()
  expect(h2.result.current?.ready).toBe(true)
  expect(h2.result.current?.error).toBeUndefined()
  expect(initSpy).toHaveBeenCalledTimes(1) // boot 幂等复用,未再 init
  expect(restoreSpy).toHaveBeenCalledTimes(1) // 上次 hide 隐去,重挂补一次
  await h2.unmount()
})

// 4. 第二实例报错
test('4. 单页单实例:第二个 hook 直接 error,第一个不受影响', async () => {
  const h1 = hookHost({})
  await h1.mount()
  const h2 = hookHost({})
  await h2.mount()
  expect(h2.result.current?.error?.message).toContain('单页只允许一个')
  expect(h2.result.current?.ready).toBe(false)
  expect(h1.result.current?.error).toBeUndefined()
  expect(h1.result.current?.ready).toBe(true)
  await h1.unmount()
  await h2.unmount()
})

// 5. storage namespace(R3:断言走 mock.calls[0] 核库名,不用 expect.anything)
test('5a. storage:{namespace} → IDB 库名带后缀', async () => {
  const openSpy = jest.spyOn(indexedDB, 'open')
  try {
    const h = hookHost({storage: {namespace: 'ns1'}})
    await h.mount()
    const names = openSpy.mock.calls.map((c) => c[0])
    expect(names).toContain('toybox-asset-library-ns1')
    expect(names).not.toContain('toybox-asset-library')
    await h.unmount()
  } finally {
    openSpy.mockRestore()
  }
})

test('5b. storage:{} → 库名与现状一字不差', async () => {
  const openSpy = jest.spyOn(indexedDB, 'open')
  try {
    const h = hookHost({storage: {}})
    await h.mount()
    const names = openSpy.mock.calls.map((c) => c[0])
    expect(names).toContain('toybox-asset-library')
    await h.unmount()
  } finally {
    openSpy.mockRestore()
  }
})

// 6. state 通道(直接驱动 BootCtx 暴露的测试钩子 notifyStateChange)
test('6. state 通道:usePersistentStorage:false + 尾部节流 + dispose flush', async () => {
  jest.useFakeTimers()
  try {
    const onStateChange = jest.fn()
    const ctx = await bootstrap.initCameraStudio({state: {onStateChange}})
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(initSpy.mock.calls[0][0]).toMatchObject({
      studio: true,
      usePersistentStorage: false,
    })
    // 窗口内多次变更只落一次(尾部触发,取最新)
    ctx.notifyStateChange({rev: 1})
    ctx.notifyStateChange({rev: 2})
    expect(onStateChange).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1000)
    expect(onStateChange).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenLastCalledWith({rev: 2})
    // dispose:订阅断开 + 未到的尾部变更立即 flush 带出
    ctx.notifyStateChange({rev: 3})
    await bootstrap.disposeCameraStudio(ctx)
    expect(onStateChange).toHaveBeenCalledTimes(2)
    expect(onStateChange).toHaveBeenLastCalledWith({rev: 3})
    expect(stateUnsubSpy).toHaveBeenCalledTimes(1)
  } finally {
    jest.useRealTimers()
  }
})

// 7. sync 透传
test('7a. sync:{serverUrl} → init opts 透传一致', async () => {
  const ctx = await bootstrap.initCameraStudio({
    sync: {serverUrl: 'wss://x'},
  })
  expect(initSpy.mock.calls[0][0]).toMatchObject({serverUrl: 'wss://x'})
  await bootstrap.disposeCameraStudio(ctx)
})

test('7b. sync 缺省 → init opts 不带 serverUrl 键(协作关)', async () => {
  const ctx = await bootstrap.initCameraStudio({})
  expect(initSpy).toHaveBeenCalledTimes(1)
  expect('serverUrl' in (initSpy.mock.calls[0][0] as object)).toBe(false)
  await bootstrap.disposeCameraStudio(ctx)
})

// 8. storage:false 纯查看器
test('8. storage:false → 纯查看器,canWrite=false 且 init 不碰 indexedDB', async () => {
  const openSpy = jest.spyOn(indexedDB, 'open')
  try {
    const ctx = await bootstrap.initCameraStudio({storage: false})
    expect(ctx.library.canWrite).toBe(false)
    const {getLibrary} = await import('./assetLibrary/library')
    expect(getLibrary().canWrite).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
    await bootstrap.disposeCameraStudio(ctx)
  } finally {
    openSpy.mockRestore()
  }
})

// 9. 冲突矩阵
test('9a. 宿主未 init → 模块按 config init', async () => {
  const ctx = await bootstrap.initCameraStudio({})
  expect(initSpy).toHaveBeenCalledTimes(1)
  expect(initSpy.mock.calls[0][0]).toMatchObject({studio: true})
  await bootstrap.disposeCameraStudio(ctx)
})

test('9b. 宿主已 init 且不一致 → console.warn 告警 + 以先到为准(不再 init)', async () => {
  simulateHostInit({studio: true, serverUrl: 'wss://other'})
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const ctx = await bootstrap.initCameraStudio({})
    expect(initSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('以先到'))
    await bootstrap.disposeCameraStudio(ctx)
  } finally {
    warnSpy.mockRestore()
  }
})

test('9c. 宿主已 init 且一致 → 静默复用:不告警、不再 init', async () => {
  simulateHostInit({studio: true})
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const ctx = await bootstrap.initCameraStudio({})
    expect(initSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    await bootstrap.disposeCameraStudio(ctx)
  } finally {
    warnSpy.mockRestore()
  }
})
