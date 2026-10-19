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
import type {WritableLibrarySource} from './assetLibrary/source'

// React 19 act 的环境开关(testing-library 会自动置,手写 harness 自己置)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// ── 替身盒子(doMock 工厂闭包共享;beforeEach 复位) ─────────────
const initSpy = jest.fn(async (_opts?: unknown) => {})
/** Scene sheet 替身:agent runtime 构造期只存引用,空对象即可 */
const fakeSheet = {fakeSheet: true}
const getProjectSpy = jest.fn((_name?: string, _opts?: unknown) => ({
  fake: true,
  sheet: jest.fn(() => fakeSheet),
}))
// studio.ui 替身:hide/restore 翻转 isHidden(与真 UI 行为一致;
// bootstrap 仅在 isHidden 时才 restore)
const setLeftStripHiddenSpy = jest.fn()
const uiBox = {
  isHidden: false,
  hide: jest.fn(() => {
    uiBox.isHidden = true
  }),
  restore: jest.fn(() => {
    uiBox.isHidden = false
  }),
  setLeftStripHidden: setLeftStripHiddenSpy,
}
const hideSpy = uiBox.hide
const restoreSpy = uiBox.restore
/** studio.initialized 替身:缺省即解析;竞态回归用例换成自持 deferred */
const initializedBox: {promise: Promise<void>} = {
  promise: Promise.resolve(),
}
const stateUnsubSpy = jest.fn()
// onChange(pointer, cb) 的返回值 = 退订函数;state 通道那条订阅的断开断言压它
const onChangeSpy = jest.fn(
  (_pointer: unknown, _cb: (v: unknown) => void) => stateUnsubSpy,
)
/** agent runtime 的 getStudio 惰性探针(构造期不调,替身即可) */
const getStudioSyncSpy = jest.fn(() => undefined)
// ── Agent API 门面替身(Task 15)──────────────────────────────
// bootstrap 静态引入 agent/api 会拉起整条命令图(PlacementManager/
// CameraPath/videoExport…),与本文件的极简 core 替身不兼容;会话接线
// (activate/dispose 调用序)在这里用桩断言,真门面行为由 api.test.tsx 覆盖
const fakeApiObject = {fakeApi: true}
const activateApiSpy = jest.fn()
const disposeApiSpy = jest.fn()
const getApiSpy = jest.fn(() => fakeApiObject)
/** 会话注册表替身(桥接接线断言用;无桥接配置时 bootstrap 不读它) */
const fakeRegistryObject = {fakeRegistry: true}
const getRegistrySpy = jest.fn(() => fakeRegistryObject)
jest.doMock('./agent/api', () => ({
  __esModule: true,
  getCameraStudioApi: getApiSpy,
  activateCameraStudioApi: activateApiSpy,
  disposeCameraStudioApi: disposeApiSpy,
  getActiveAgentRegistry: getRegistrySpy,
}))
// ── 桥接客户端替身(Task 6)──────────────────────────────────
// 真客户端会拉起 WebSocket;接线契约(配置门槛、启动/关闭时序)用桩断言,
// 客户端自身行为由 bridgeClient.test.ts 覆盖
const bridgeClientCloseSpy = jest.fn()
const createBridgeClientSpy = jest.fn(() => ({close: bridgeClientCloseSpy}))
jest.doMock('./agent/bridgeClient', () => ({
  __esModule: true,
  createAgentBridgeClient: createBridgeClientSpy,
}))
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

jest.doMock('@dreamerbird/studio', () => ({
  __esModule: true,
}))
jest.doMock('@dreamerbird/core', () => ({
  __esModule: true,
  default: {init: initSpy},
  getProject: getProjectSpy,
  getStudio: () => ({ui: uiBox, initialized: initializedBox.promise}),
  getStudioSync: getStudioSyncSpy,
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
  initializedBox.promise = Promise.resolve()
  setLeftStripHiddenSpy.mockClear()
  getStudioSyncSpy.mockClear()
  activateApiSpy.mockClear()
  disposeApiSpy.mockClear()
  getApiSpy.mockClear()
  getRegistrySpy.mockClear()
  createBridgeClientSpy.mockClear()
  bridgeClientCloseSpy.mockClear()
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
  expect(setLeftStripHiddenSpy).not.toHaveBeenCalled() // 缺省配置不动 LeftStrip
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

// 2b. Agent API 会话接线(Task 15):挂载激活、卸载先拆 API
test('2b. Agent API:挂载激活门面(exposeGlobal 透传),卸载先 dispose API 再做既有清理', async () => {
  const h = hookHost({agent: {exposeGlobal: true}})
  await h.mount()
  expect(h.result.current?.ready).toBe(true)
  // 激活一次;第二参透传 exposeGlobal;runtime 持有 fakeSheet
  expect(activateApiSpy).toHaveBeenCalledTimes(1)
  const [runtime, opts] = activateApiSpy.mock.calls[0] as any[]
  expect(opts).toEqual({exposeGlobal: true})
  expect(runtime.sheet).toBe(fakeSheet)
  // handle.api 与 BootCtx 同源(模块级单例门面)
  expect(h.result.current?.api).toBe(fakeApiObject)
  await h.unmount()
  await flush()
  // 拆解顺序:dispose API 先于编辑器注销(挂载 waiter/在途任务先被拒)
  expect(disposeApiSpy).toHaveBeenCalledTimes(1)
  expect(disposeApiSpy.mock.invocationCallOrder[0]).toBeLessThan(
    unregisterSpy.mock.invocationCallOrder[0],
  )
})

// 2c. exposeGlobal 缺省关闭:浏览器默认不挂 window 全局
test('2c. Agent API:未配置 agent.exposeGlobal 时以 false 激活', async () => {
  const h = hookHost({})
  await h.mount()
  expect(activateApiSpy).toHaveBeenCalledTimes(1)
  expect((activateApiSpy.mock.calls[0] as any[])[1]).toEqual({
    exposeGlobal: false,
  })
  await h.unmount()
})

// 2d. 桥接客户端接线(Task 6):显式配置才启动;拆解先关客户端再 dispose API
test('2d. Agent 桥接:agent.bridge 显式配置才启动客户端;拆解顺序 close → dispose API', async () => {
  const bridge = {
    url: 'ws://127.0.0.1:43110',
    token: 't',
    httpUrl: 'http://127.0.0.1:43110',
  }
  const h = hookHost({agent: {bridge}})
  await h.mount()
  // 启动在 API 激活之后,使用会话自身注册表与 runtime
  expect(createBridgeClientSpy).toHaveBeenCalledTimes(1)
  const deps = (createBridgeClientSpy.mock.calls[0] as any[])[0]
  expect(deps.config).toBe(bridge)
  expect(deps.registry).toBe(fakeRegistryObject)
  expect(deps.runtime).toBe((activateApiSpy.mock.calls[0] as any[])[0])
  expect(createBridgeClientSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
    activateApiSpy.mock.invocationCallOrder[0],
  )
  await h.unmount()
  await flush()
  // 拆解:先关桥接客户端(停重连/退订任务),再 dispose API
  expect(bridgeClientCloseSpy).toHaveBeenCalledTimes(1)
  expect(bridgeClientCloseSpy.mock.invocationCallOrder[0]).toBeLessThan(
    disposeApiSpy.mock.invocationCallOrder[0],
  )
})

// 2e. 桥接缺省不连:未配置 agent.bridge 时客户端不启动、拆解不涉及
test('2e. Agent 桥接:未配置 agent.bridge 时不启动客户端', async () => {
  const h = hookHost({})
  await h.mount()
  expect(createBridgeClientSpy).not.toHaveBeenCalled()
  expect(getRegistrySpy).not.toHaveBeenCalled()
  await h.unmount()
  await flush()
  expect(bridgeClientCloseSpy).not.toHaveBeenCalled()
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

// 10. 缺省库名启动清理(T9 顺带,T8 评审遗留):sweepOrphanBlobs 与
// ensureBuiltinRigAlias 并入 boot 的内置 IDB 缺省库名分支
test('10a. 缺省内置 IDB:孤儿清扫与骨架族别名保底都被调用', async () => {
  const libModule = await import('./assetLibrary/library')
  const idbModule = await import('./assetLibrary/indexedDBBackend')
  const sweepSpy = jest.spyOn(libModule.Library.prototype, 'sweepOrphanBlobs')
  // ensureBuiltinRigAlias 是独立导出函数(不可 spy 模块导出);M-4 并集读
  // 后它直读可写源自有列表——spy 它触达的 IndexedDBBackend.getRigAliases:
  // 调用即代表保底跑了
  const aliasSpy = jest.spyOn(
    idbModule.IndexedDBBackend.prototype,
    'getRigAliases',
  )
  try {
    const h = hookHost({}) // storage 缺省 = 缺省库名
    await h.mount()
    expect(sweepSpy).toHaveBeenCalled()
    expect(aliasSpy).toHaveBeenCalled()
    await h.unmount()
  } finally {
    sweepSpy.mockRestore()
    aliasSpy.mockRestore()
  }
})

test('10b. namespace 分支:清扫与别名保底都不调', async () => {
  const libModule = await import('./assetLibrary/library')
  const idbModule = await import('./assetLibrary/indexedDBBackend')
  const sweepSpy = jest.spyOn(libModule.Library.prototype, 'sweepOrphanBlobs')
  const aliasSpy = jest.spyOn(
    idbModule.IndexedDBBackend.prototype,
    'getRigAliases',
  )
  try {
    const h = hookHost({storage: {namespace: 'ns-clean'}})
    await h.mount()
    expect(sweepSpy).not.toHaveBeenCalled()
    expect(aliasSpy).not.toHaveBeenCalled()
    await h.unmount()
  } finally {
    sweepSpy.mockRestore()
    aliasSpy.mockRestore()
  }
})

test('10c. storage:false 纯查看器:无可写源,清扫与别名保底都不调', async () => {
  const libModule = await import('./assetLibrary/library')
  const idbModule = await import('./assetLibrary/indexedDBBackend')
  const sweepSpy = jest.spyOn(libModule.Library.prototype, 'sweepOrphanBlobs')
  const aliasSpy = jest.spyOn(
    idbModule.IndexedDBBackend.prototype,
    'getRigAliases',
  )
  try {
    const h = hookHost({storage: false})
    await h.mount()
    expect(sweepSpy).not.toHaveBeenCalled()
    expect(aliasSpy).not.toHaveBeenCalled()
    await h.unmount()
  } finally {
    sweepSpy.mockRestore()
    aliasSpy.mockRestore()
  }
})

// T9 评审 F2:宿主可写源实例分支(idbName 同为 undefined)此前无负面用例。
// 三个清理(cleanupLegacySeeds/sweepOrphanBlobs/ensureBuiltinRigAlias)同在
// boot 的 idbName === DEFAULT_IDB_NAME 守卫块内:sweep 未调即整块未进,
// 三者一并兜住(与 10b/10c 同一断言策略)
test('10d. 宿主可写源实例:缺省库名清理三项都不调', async () => {
  const libModule = await import('./assetLibrary/library')
  const idbModule = await import('./assetLibrary/indexedDBBackend')
  const sweepSpy = jest.spyOn(libModule.Library.prototype, 'sweepOrphanBlobs')
  // ensureBuiltinRigAlias 是独立导出函数(不可 spy 模块导出);M-4 并集读
  // 后它直读可写源自有列表——spy 它触达的 IndexedDBBackend.getRigAliases:
  // 调用即代表保底跑了
  const aliasSpy = jest.spyOn(
    idbModule.IndexedDBBackend.prototype,
    'getRigAliases',
  )
  try {
    const hostSource: WritableLibrarySource = {
      id: 'host-src',
      listEntries: async () => [],
      getEntry: async () => undefined,
      getBlobUrl: async () => '',
      putEntry: async () => {},
      deleteEntry: async () => {},
      putBlob: async () => 'blob:x',
      deleteBlob: async () => {},
      getRigAliases: async () => [],
      putRigAlias: async () => {},
    }
    const h = hookHost({storage: hostSource})
    await h.mount()
    expect(sweepSpy).not.toHaveBeenCalled()
    expect(aliasSpy).not.toHaveBeenCalled()
    await h.unmount()
  } finally {
    sweepSpy.mockRestore()
    aliasSpy.mockRestore()
  }
})

// 11. config 漂移(终审 I-1(b)):已 boot 后重挂换配置——告警一次并点名
// 差异键;sceneProps 沿用首 boot;不为新 config 调 getProject 造闲置
// IProject。换配置的正确姿势是整页刷新(React 重挂不生效)。
test('11. 重挂换配置:warn 点名差异键一次,sceneProps 沿用首 boot,getProject 不为新 id 调用', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const h1 = hookHost({project: 'SceneA'})
    await h1.mount()
    const firstProject = h1.result.current?.sceneProps.project
    expect(getProjectSpy).toHaveBeenCalledWith('SceneA', expect.anything())
    await h1.unmount()
    getProjectSpy.mockClear()

    // 重挂传不同 project + sync:差异键被点名,只告警一次
    const h2 = hookHost({project: 'SceneB', sync: {serverUrl: 'wss://y'}})
    await h2.mount()
    const driftWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('config 与首次 boot 不一致'),
    )
    expect(driftWarns).toHaveLength(1)
    expect(String(driftWarns[0][0])).toContain('project')
    expect(String(driftWarns[0][0])).toContain('sync')
    // sceneProps 沿用首 boot 的 project(同实例);getProject 未为新 id 调用
    expect(h2.result.current?.sceneProps.project).toBe(firstProject)
    expect(getProjectSpy.mock.calls.every((c) => c[0] !== 'SceneB')).toBe(true)
    await h2.unmount()

    // 第三次重挂(又不同 config):不重复告警
    const h3 = hookHost({project: 'SceneC'})
    await h3.mount()
    expect(
      warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('config 与首次 boot 不一致'),
      ),
    ).toHaveLength(1)
    await h3.unmount()
  } finally {
    warnSpy.mockRestore()
  }
})

// 12. 宿主错误提示接口(2026-10-16 收尾):库存储错误经 config.onError
// 转成宿主可渲染的 CameraStudioError;sceneProps 同时透传给 CameraScene
// (视频导出错误也走同一回调)。
test('12a. onError:库错误转成 CameraStudioError,sceneProps 透传同一回调', async () => {
  const onError = jest.fn()
  const {LibraryError} = await import('./assetLibrary/source')
  // storage:false 跳过启动清理,断言只压 reportError 这一通路上
  const ctx = await bootstrap.initCameraStudio({storage: false, onError})
  expect(ctx.sceneProps.onError).toBe(onError)

  const cause = new Error('disk full')
  ctx.library.reportError(new LibraryError('quota', '额度不足', cause))
  expect(onError).toHaveBeenCalledTimes(1)
  expect(onError.mock.calls[0][0]).toMatchObject({
    source: 'library',
    code: 'quota',
    message: '额度不足',
    cause,
  })
  await bootstrap.disposeCameraStudio(ctx)
})

test('12b. 启动清理失败:有 onError 上告宿主,不再走 console.warn', async () => {
  const libModule = await import('./assetLibrary/library')
  const failure = new Error('idb busy')
  const sweepSpy = jest
    .spyOn(libModule.Library.prototype, 'sweepOrphanBlobs')
    .mockRejectedValue(failure)
  const onError = jest.fn()
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const h = hookHost({onError})
    await h.mount()
    await flush()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'library',
        code: 'unknown',
        message: '孤儿 blob 清扫失败',
        cause: failure,
      }),
    )
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('孤儿 blob 清扫失败'),
      ),
    ).toBe(false)
    await h.unmount()
  } finally {
    sweepSpy.mockRestore()
    warnSpy.mockRestore()
  }
})

test('13. 显隐恢复竞态回归:initialized 未收尾前不判 isHidden,收尾后补恢复', async () => {
  // 场景:上次 dispose 的 hidden 随同步恢复落库。落库前(initialized 挂起)
  // restore-check 不得抢跑(抢跑读到可见快照就会漏恢复,UI 永久隐藏——
  // 2026-10-16 线上事故根因);落库后(initialized 解析)必须补恢复
  let releaseInit!: () => void
  initializedBox.promise = new Promise<void>((r) => (releaseInit = r))
  const h = hookHost({})
  await h.mount()
  expect(h.result.current?.ready).toBe(true)
  await flush()
  // initialized 挂起中:即使 isHidden 马上会翻真,此刻也不得发 restore
  expect(restoreSpy).not.toHaveBeenCalled()
  // 同步落库(状态恢复为 hidden)→ initialized 解析 → restore-check 补恢复
  uiBox.isHidden = true
  releaseInit()
  await flush()
  expect(restoreSpy).toHaveBeenCalledTimes(1)
  expect(uiBox.isHidden).toBe(false)
  await h.unmount()
})

test('14. ui.hideLeftStrip → boot 经 studio.ui.setLeftStripHidden(true) 应用', async () => {
  const h = hookHost({ui: {hideLeftStrip: true}})
  await h.mount()
  expect(h.result.current?.ready).toBe(true)
  await flush()
  expect(setLeftStripHiddenSpy).toHaveBeenCalledWith(true)
  await h.unmount()
})
