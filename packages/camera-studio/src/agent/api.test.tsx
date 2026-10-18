/*
 * @jest-environment jsdom
 */
/**
 * 公开 JS API 门面与启动生命周期(2026-10-19,Task 15,spec §7):
 *
 * suite 1 命名空间转发:fake runtime + stub registry,遍历 spec §9 全部
 *   71 条命令对应的门面方法,断言转发到同名命令、参数原样透传(同引用)、
 *   返回原始领域结果(绝不包装 {ok,result}),错误以 AgentApiError 原样抛出;
 *   另用真实 registerAllAgentCommands 断言注册清单与 spec 命令面一致、
 *   门面映射与注册表零漂移。
 * suite 2 ready/dispose/remount:handlers 未绑定不 ready;绑定后 resolve;
 *   dispose 拒绝 pending ready/在途调用/placement·camera·anchor waiter,
 *   在途任务硬取消;解绑使代次就绪失效(旧 unsettled ready 以
 *   API_NOT_READY 拒绝不悬挂),重绑产出新代次;会话拆解后重激活可重新
 *   ready,旧代次 promise 不写入新 runtime。
 * suite 3 公开导出与全局暴露:useCameraStudio 首帧与后续 render 返回同一
 *   api(模块级单例);window.__cameraStudioApi 仅在 agent.exposeGlobal:true
 *   且场景 ready 后出现,dispose 时删除;CameraFlows 八方法签名不变、
 *   onFlows 只触发一次、卸载不错误调用新 host;CameraScene 生产绑定全量
 *   Scene Runtime handlers,且 createCamera 不自动设活动相机(Task 10
 *   决策:create/setActive 是两条显式命令)。
 *
 * mock 手法同 CameraScene.test.tsx / bootstrap.test.tsx:jest-esbuild 不提升
 * jest.mock,doMock 先行登记 + 运行时 require;核心替身盒在两文件基础上合并
 * (bootstrap 需要 default.init/getStudio/initState/privateAPIs,组件渲染
 * 需要 getStudioSync/val 与 Canvas 替身)。
 */
import React from 'react'
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import type {CameraStudioConfig, CameraStudioHandle} from '../config'
import type {CameraFlows} from '../hostFlows'
import type {AgentRuntime} from './runtime'
import type {CameraStudioApi} from './api'
import {AgentApiError} from './errors'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()
// pipLayout 的 effect 用 ResizeObserver(jsdom 无此 API),补空实现
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ── core 替身盒(bootstrap + 组件渲染两套需求合并) ─────────────
const initSpy = jest.fn(async (_opts?: unknown) => {})
const fakeSheet = {
  address: {projectId: 'proj-x', sheetId: 'Scene', sheetInstanceId: 'default'},
  sequence: {pointer: {playing: {}}},
}
const getProjectSpy = jest.fn((name?: string, _opts?: unknown) => ({
  address: {projectId: name ?? 'Space'},
  sheet: () => fakeSheet,
}))
const uiBox = {
  isHidden: false,
  hide: jest.fn(() => {
    uiBox.isHidden = true
  }),
  restore: jest.fn(() => {
    uiBox.isHidden = false
  }),
  setLeftStripHidden: jest.fn(),
}
const studioBox = {ui: uiBox, initialized: Promise.resolve()}
const unsubSpy = jest.fn()
const onChangeSpy = jest.fn((_pointer: unknown, _cb: unknown) => unsubSpy)
/** 模拟 core 的 initState:init 首次调用翻转(与真 core 行为一致) */
const initStateBox: {
  called: boolean
  optsDeferred: {promise: Promise<unknown>}
} = {
  called: false,
  optsDeferred: {promise: new Promise(() => {})},
}
initSpy.mockImplementation(async (opts?: unknown) => {
  if (!initStateBox.called) {
    initStateBox.called = true
    initStateBox.optsDeferred = {promise: Promise.resolve(opts)}
  }
})

jest.doMock('@dreamerbird/core', () => {
  const actual = jest.requireActual('@dreamerbird/core')
  return {
    ...actual,
    __esModule: true,
    // default 与 named 双写:esbuild 互操作在无 __esModule 标记时会把整个
    // 模块命名空间当作 default,theatre.init 会落到 actual 的真 init 上
    // (实测栈:core/src/index.ts:51 optsDeferred.resolve 不是函数)
    init: initSpy,
    default: {init: initSpy},
    getProject: getProjectSpy,
    getStudio: () => studioBox,
    getStudioSync: () => undefined,
    onChange: onChangeSpy,
    val: (x: unknown) => x,
  }
})
jest.doMock('@dreamerbird/core/initState', () => ({
  __esModule: true,
  initState: initStateBox,
}))
// getObject 探测恒 undefined = 注册表均未创建(scene.getSnapshot 端到端
// 据此拿到空清单);historic 指针供 bootstrap 的 revision/state 订阅
jest.doMock('@dreamerbird/core/privateAPIs', () => ({
  __esModule: true,
  privateAPI: () => ({
    pointers: {historic: {}},
    getObject: () => undefined,
  }),
}))
jest.doMock('@dreamerbird/studio', () => ({__esModule: true}))
jest.doMock('@dreamerbird/studio/propEditors/customPropEditors', () => ({
  __esModule: true,
  registerCustomPropEditor: jest.fn(),
  unregisterCustomPropEditor: jest.fn(),
}))
jest.doMock('../poseMode/PosePropEditor', () => ({
  __esModule: true,
  default: () => null,
}))
jest.doMock('../gesturePropsEditor', () => ({
  __esModule: true,
  GesturePropEditorLeft: () => null,
  GesturePropEditorRight: () => null,
}))
jest.doMock('@dreamerbird/react', () => ({
  __esModule: true,
  usePrism: (fn: () => unknown) => fn(),
  useVal: () => undefined,
}))
// Canvas 替身:丢弃子树(Canvas 内组件不进 jsdom);断言全在 Canvas 外
jest.doMock('@react-three/fiber', () => ({
  __esModule: true,
  Canvas: () => React.createElement('div', {'data-testid': 'canvas-fake'}),
  useFrame: () => {},
  useThree: () => ({}),
}))
jest.doMock('../TopToolbar', () => ({
  __esModule: true,
  TopToolbar: () => null,
}))
jest.doMock('../scene.glb', () => 'scene.glb')
jest.doMock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: class RoomEnvironment {},
}))
const noop = () => {}
const noopComponent = () => null
jest.doMock('../PlacementManager', () => ({
  __esModule: true,
  PlacementRig: noopComponent,
  PlacementRigErrorBoundary: class extends React.Component<{
    children?: React.ReactNode
  }> {
    render() {
      return this.props.children
    }
  },
  PlacedModels: noopComponent,
  SelectionGizmo: noopComponent,
  deletePlacement: noop,
  getPlacementEntryForObject: () => undefined,
  getPlacementInstanceForObject: () => undefined,
  isSelectSuppressed: () => false,
  readPlacementEntries: () => [],
  readPlacementPositions: () => [],
  useGizmoMode: () => ['translate', noop],
  usePlacementController: () => ({
    placing: null,
    pendingEntry: null,
    startPlacingFromLibrary: async () => {},
    // 与生产形状一致:Agent createModel handler 的 {key, persisted} 契约
    placeLibraryEntryAt: () => ({key: 'm1', persisted: Promise.resolve()}),
    cancelPlacing: noop,
    confirmPlacing: noop,
    clearPending: noop,
  }),
  usePlacementSurface: noop,
  useSelectionGizmoTarget: noop,
}))
// 相机清单可变:cam-new 预先在清单里——若 createCamera 绑定自动设活动,
// 活动推导会解析到 cam-new(决策断言据此可区分两种行为)
const cameraList: Array<{cameraKey: string}> = [
  {cameraKey: 'cam-1'},
  {cameraKey: 'cam-new'},
]
const addCameraToRegistrySpy = jest.fn()
jest.doMock('../cameraRegistry', () => ({
  __esModule: true,
  addCameraToRegistry: (...args: unknown[]) => addCameraToRegistrySpy(...args),
  cameraDisplayName: (key: string) => key,
  getCamerasRegistry: () => ({}),
  nextCameraEntry: () => ({cameraKey: 'cam-new'}),
  readCameraEntries: () => [],
  removeCamera: noop,
  // 与真实现同语义:活动 key 在清单里取之,否则顺位第一台,空清单 null
  resolveActiveCamera: (
    cameras: Array<{cameraKey: string}>,
    key: string | null,
  ) => cameras.find((e) => e.cameraKey === key) ?? cameras[0] ?? null,
  useCamerasList: () => cameraList,
}))
jest.doMock('../anchorsRegistry', () => ({
  __esModule: true,
  addAnchorToRegistry: noop,
  nextAnchorKey: () => 'Anchor 1',
  removeAnchor: noop,
  useAnchorsList: () => [],
}))
jest.doMock('../pathRegistry', () => ({
  __esModule: true,
  addPathToRegistry: noop,
  nextPathEntry: () => ({pathKey: 'path-1'}),
  readPathEntries: () => [],
  getPathsRegistry: () => ({}),
  removePathFromRegistry: noop,
  usePathsList: () => [],
}))
jest.doMock('../CameraPath', () => ({
  __esModule: true,
  addPathPoint: noop,
  CameraPath: noopComponent,
  deletePathPoint: () => false,
  getPathMeta: () => null,
  PathEditBar: noopComponent,
  PathPointEditor: noopComponent,
  pathExists: () => false,
  POS_PATH_KEY: 'Pos Path',
  readPathPoints: () => [],
  samplePathPoint: () => false,
  usePathExists: () => false,
}))
jest.doMock('../poseMode/poseSession', () => ({
  __esModule: true,
  enterPoseSession: noop,
  getPoseSession: () => null,
  isModelDoubleClick: () => false,
  onPoseSessionChange: () => () => {},
  poseHitTest: () => false,
  requestPoseExit: noop,
  usePoseSessionKey: () => null,
}))
jest.doMock('../videoExport/sinks', () => ({
  __esModule: true,
  listSinks: () => [],
}))
jest.doMock('../videoExport/exporter', () => ({
  __esModule: true,
  startShotExport: () => null,
}))

const {createCameraStudioApi} = require('./api') as typeof import('./api')
const {createAgentRuntime} = require('./runtime') as typeof import('./runtime')
const {AgentCommandRegistry} =
  require('./registry') as typeof import('./registry')
const {registerAllAgentCommands} =
  require('./registerCommands') as typeof import('./registerCommands')
const {createPlacementWaiter} =
  require('./runtime/placementLifecycle') as typeof import('./runtime/placementLifecycle')
const {createCameraWaiter, createAnchorWaiter} =
  require('./runtime/cameraLifecycle') as typeof import('./runtime/cameraLifecycle')
const {useCameraStudio} =
  require('../useCameraStudio') as typeof import('../useCameraStudio')
const {CameraScene} =
  require('../CameraScene') as typeof import('../CameraScene')
const {getHostFlowsHandle} =
  require('../hostFlows') as typeof import('../hostFlows')
const apiInternals = require('./api') as typeof import('./api')

/** spec §9 命令面:facade 路径 → 命令名(poses.session/paths.session 为嵌套命名空间) */
const FACADE_COMMANDS: ReadonlyArray<{
  path: string
  command: string
  args?: unknown
}> = [
  {path: 'scene.getSnapshot', command: 'scene.getSnapshot'},
  {path: 'selection.get', command: 'selection.get'},
  {
    path: 'selection.selectObject',
    command: 'selection.selectObject',
    args: {objectId: 'model:Y Bot'},
  },
  {path: 'selection.clear', command: 'selection.clear'},
  {path: 'objects.list', command: 'objects.list'},
  {path: 'objects.get', command: 'objects.get', args: {objectId: 'model:M'}},
  {
    path: 'objects.update',
    command: 'objects.update',
    args: {objectId: 'model:M', props: {position: {x: 1, y: 0, z: 0}}},
  },
  {
    path: 'objects.delete',
    command: 'objects.delete',
    args: {objectId: 'model:M'},
  },
  {
    path: 'models.create',
    command: 'models.create',
    args: {assetId: 'asset-1', position: {x: 0, y: 0, z: 0}},
  },
  {path: 'assets.list', command: 'assets.list'},
  {path: 'assets.get', command: 'assets.get', args: {assetId: 'asset-1'}},
  {
    path: 'assets.importModel',
    command: 'assets.importModel',
    args: {file: {name: 'm.glb'}},
  },
  {
    path: 'assets.rename',
    command: 'assets.rename',
    args: {assetId: 'asset-1', name: '新名字'},
  },
  {path: 'assets.delete', command: 'assets.delete', args: {assetId: 'asset-1'}},
  {
    path: 'poses.apply',
    command: 'poses.apply',
    args: {objectId: 'model:M', assetId: 'pose-1'},
  },
  {
    path: 'poses.applyCustom',
    command: 'poses.applyCustom',
    args: {objectId: 'model:M', bones: {}},
  },
  {path: 'poses.clear', command: 'poses.clear', args: {objectId: 'model:M'}},
  {
    path: 'poses.saveCurrent',
    command: 'poses.saveCurrent',
    args: {objectId: 'model:M', name: 'p'},
  },
  {
    path: 'poses.setGesture',
    command: 'poses.setGesture',
    args: {objectId: 'model:M', side: 'left', assetId: null},
  },
  {
    path: 'poses.session.start',
    command: 'poses.session.start',
    args: {objectId: 'model:M'},
  },
  {path: 'poses.session.commit', command: 'poses.session.commit'},
  {path: 'poses.session.cancel', command: 'poses.session.cancel'},
  {
    path: 'animations.apply',
    command: 'animations.apply',
    args: {objectId: 'model:M', assetId: 'anim-1'},
  },
  {
    path: 'animations.clear',
    command: 'animations.clear',
    args: {objectId: 'model:M'},
  },
  {
    path: 'animations.getStatus',
    command: 'animations.getStatus',
    args: {objectId: 'model:M'},
  },
  {path: 'cameras.create', command: 'cameras.create', args: {}},
  {
    path: 'cameras.setActive',
    command: 'cameras.setActive',
    args: {objectId: 'camera:C'},
  },
  {
    path: 'cameras.setAimTarget',
    command: 'cameras.setAimTarget',
    args: {objectId: 'camera:C', target: ''},
  },
  {
    path: 'cameras.bindPath',
    command: 'cameras.bindPath',
    args: {objectId: 'camera:C', pathId: 'path:P'},
  },
  {
    path: 'cameras.unbindPath',
    command: 'cameras.unbindPath',
    args: {objectId: 'camera:C'},
  },
  {path: 'anchors.create', command: 'anchors.create', args: {}},
  {
    path: 'anchors.setParent',
    command: 'anchors.setParent',
    args: {objectId: 'anchor:A', parent: ''},
  },
  {
    path: 'anchors.clearParent',
    command: 'anchors.clearParent',
    args: {objectId: 'anchor:A'},
  },
  {path: 'paths.listPresets', command: 'paths.listPresets'},
  {
    path: 'paths.createPreset',
    command: 'paths.createPreset',
    args: {preset: 'line'},
  },
  {path: 'paths.addPoint', command: 'paths.addPoint', args: {pathId: 'path:P'}},
  {
    path: 'paths.updatePoint',
    command: 'paths.updatePoint',
    args: {pathId: 'path:P', pointKey: 'k1'},
  },
  {
    path: 'paths.deletePoint',
    command: 'paths.deletePoint',
    args: {pathId: 'path:P', pointKey: 'k1'},
  },
  {
    path: 'paths.setPointTiming',
    command: 'paths.setPointTiming',
    args: {pathId: 'path:P', pointKey: 'k1'},
  },
  {
    path: 'paths.sample',
    command: 'paths.sample',
    args: {pathId: 'path:P', u: 0.5},
  },
  {
    path: 'paths.session.startEditing',
    command: 'paths.session.startEditing',
    args: {pathId: 'path:P'},
  },
  {path: 'paths.session.exitEditing', command: 'paths.session.exitEditing'},
  {
    path: 'paths.session.selectPoint',
    command: 'paths.session.selectPoint',
    args: {pathId: 'path:P', pointKey: 'k1'},
  },
  {path: 'sequence.getState', command: 'sequence.getState'},
  {path: 'sequence.play', command: 'sequence.play'},
  {path: 'sequence.pause', command: 'sequence.pause'},
  {path: 'sequence.seek', command: 'sequence.seek', args: {position: 1.5}},
  {
    path: 'sequence.setLength',
    command: 'sequence.setLength',
    args: {length: 8},
  },
  {
    path: 'keyframes.list',
    command: 'keyframes.list',
    args: {objectId: 'model:M', propPath: ['position']},
  },
  {
    path: 'keyframes.set',
    command: 'keyframes.set',
    args: {objectId: 'model:M', propPath: ['position'], at: 0, value: 1},
  },
  {
    path: 'keyframes.move',
    command: 'keyframes.move',
    args: {objectId: 'model:M', propPath: ['position'], from: 0, to: 1},
  },
  {
    path: 'keyframes.delete',
    command: 'keyframes.delete',
    args: {objectId: 'model:M', propPath: ['position'], at: 0},
  },
  {path: 'history.undo', command: 'history.undo'},
  {path: 'history.redo', command: 'history.redo'},
  {path: 'view.getState', command: 'view.getState'},
  {path: 'view.setShotView', command: 'view.setShotView', args: {on: true}},
  {
    path: 'view.setPipVisible',
    command: 'view.setPipVisible',
    args: {visible: false},
  },
  {
    path: 'view.orbit',
    command: 'view.orbit',
    args: {deltaTheta: 0.1, deltaPhi: 0},
  },
  {path: 'view.pan', command: 'view.pan', args: {deltaX: 1, deltaY: 2}},
  {path: 'view.dolly', command: 'view.dolly', args: {delta: 0.5}},
  {path: 'view.reset', command: 'view.reset'},
  {path: 'ui.hide', command: 'ui.hide'},
  {path: 'ui.restore', command: 'ui.restore'},
  {
    path: 'ui.setLeftStripHidden',
    command: 'ui.setLeftStripHidden',
    args: {hidden: true},
  },
  {path: 'ui.openPanel', command: 'ui.openPanel', args: {panel: 'model'}},
  {path: 'ui.closePanel', command: 'ui.closePanel', args: {panel: 'model'}},
  {
    path: 'ui.setGizmoMode',
    command: 'ui.setGizmoMode',
    args: {mode: 'rotate'},
  },
  {path: 'project.exportState', command: 'project.exportState'},
  {path: 'exports.startVideo', command: 'exports.startVideo'},
  {path: 'jobs.get', command: 'jobs.get', args: {jobId: 'job-1'}},
  {path: 'jobs.cancel', command: 'jobs.cancel', args: {jobId: 'job-1'}},
]

/** CameraScene 生产绑定必须提供的完整 handler 集(命令侧 SCENE_UNAVAILABLE 的依据) */
const HANDLER_KEYS = [
  'createModel',
  'createCamera',
  'setActiveCamera',
  'createAnchor',
  'getModelPlacement',
  'openPanel',
  'closePanel',
  'setGizmoMode',
  'getViewState',
  'setShotView',
  'setPipVisible',
  'startPathEditing',
  'exitPathEditing',
  'selectPathPoint',
  'getPathEditingState',
  'clearPathPointSelection',
  'afterSceneObjectDeleted',
] as const

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 断言 promise 在一个 macrotask 后仍未 settle */
async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await tick()
  expect(settled).toBe(false)
}

/** 最小会话 deps:project/sheet/library 不被注册路径触达 */
function makeRuntime(): AgentRuntime {
  return createAgentRuntime({
    project: {} as never,
    sheet: {} as never,
    library: {} as never,
    getStudio: () => undefined,
    subscribeHistoric: () => () => {},
  })
}

/** stub 注册表工厂:execute 回显命令名与参数(转发断言用) */
function stubRegistryFactory(execute: jest.Mock) {
  return () =>
    ({
      execute,
      describe: () => ({apiVersion: 1 as const, commands: []}),
    }) as unknown as import('./registry').AgentCommandRegistry
}

function callFacade(
  api: CameraStudioApi,
  path: string,
  args: unknown,
): Promise<unknown> {
  let target: unknown = api
  for (const part of path.split('.')) {
    target = (target as Record<string, unknown>)[part]
  }
  return (target as (a?: unknown) => Promise<unknown>)(args)
}

afterEach(() => {
  jest.clearAllMocks()
  initStateBox.called = false
  initStateBox.optsDeferred = {promise: new Promise(() => {})}
  uiBox.isHidden = false
  delete (window as any).__cameraStudioApi
})

// ── suite 1:命名空间转发与结果形状 ─────────────────────────────
describe('命名空间转发', () => {
  test('每个门面方法转发到同名命令:参数同引用透传,结果原样返回(无 {ok,result} 包装)', async () => {
    const execute = jest.fn(async (name: string, args: unknown) => ({
      echo: name,
      received: args,
    }))
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    const runtime = makeRuntime()
    controller.activate(runtime)
    const unbind = controller.bindSceneHandlers({})!
    await controller.api.ready

    for (const {path, command, args} of FACADE_COMMANDS) {
      const result = await callFacade(controller.api, path, args)
      // 原始领域结果,不是信封
      expect(result).toEqual({echo: command, received: args})
    }
    expect(execute).toHaveBeenCalledTimes(FACADE_COMMANDS.length)
    const requestIds = new Set<string>()
    FACADE_COMMANDS.forEach(({command, args}, i) => {
      const [name, passedArgs, context] = execute.mock.calls[i] as unknown as [
        string,
        unknown,
        {requestId: string; signal: AbortSignal},
      ]
      expect(name).toBe(command)
      // 参数原样透传(同引用;expectedRevision 等字段保留在 args 内)
      expect(passedArgs).toBe(args)
      // 每次调用生成新的 requestId 与 AbortSignal
      expect(typeof context.requestId).toBe('string')
      requestIds.add(context.requestId)
      expect(context.signal).toBeInstanceOf(AbortSignal)
    })
    expect(requestIds.size).toBe(FACADE_COMMANDS.length)
    unbind()
    controller.dispose()
  })

  test('参数错误与领域错误以同一个 AgentApiError 抛出(实例原样透传)', async () => {
    const domainError = new AgentApiError('REVISION_CONFLICT', 'revision 冲突')
    const execute = jest.fn(async () => {
      throw domainError
    })
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    controller.activate(makeRuntime())
    const unbind = controller.bindSceneHandlers({})!
    await controller.api.ready
    await expect(controller.api.objects.list()).rejects.toBe(domainError)
    unbind()
    controller.dispose()
  })

  test('真实注册表:validate 参数错误以 AgentApiError(INVALID_ARGUMENT)抛出', async () => {
    const controller = createCameraStudioApi()
    controller.activate(makeRuntime())
    const unbind = controller.bindSceneHandlers({})!
    await controller.api.ready
    // objects.get 缺 objectId:validate 阶段失败,不触达 execute/副作用
    await expect(controller.api.objects.get({} as never)).rejects.toMatchObject(
      {code: 'INVALID_ARGUMENT'},
    )
    unbind()
    controller.dispose()
  })

  test('registerAllAgentCommands 注册清单与 spec §9 命令面一致,门面映射零漂移', () => {
    const registry = new AgentCommandRegistry()
    // 注册路径不触达 runtime(全部闭包到 execute 才用)
    registerAllAgentCommands(registry, {} as never)
    const names = registry.describe().commands.map((c) => c.name)
    const specNames = FACADE_COMMANDS.map((row) => commandOf(row)).sort()
    expect(names).toEqual(specNames)
    // 无重复(registry.register 已按名拒重,这里复核一次)
    expect(new Set(names).size).toBe(names.length)
  })
})

function commandOf(row: {command: string}): string {
  return row.command
}

// ── suite 2:ready / dispose / remount ──────────────────────────
describe('生命周期', () => {
  test('handlers 未绑定时不 ready:ready 与调用都挂起;绑定后 resolve,挂起调用继续执行', async () => {
    const execute = jest.fn(async (name: string, args: unknown) => ({
      echo: name,
      received: args,
    }))
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    controller.activate(makeRuntime())
    await expectPending(controller.api.ready)
    const inflight = callFacade(controller.api, 'scene.getSnapshot', undefined)
    await expectPending(inflight)
    const unbind = controller.bindSceneHandlers({})!
    await controller.api.ready
    await expect(inflight).resolves.toEqual({
      echo: 'scene.getSnapshot',
      received: undefined,
    })
    unbind()
    controller.dispose()
  })

  test('dispose:拒绝 pending ready 与在途调用;后续调用与 ready 以 API_DISPOSED 失败;describe 同', async () => {
    const execute = jest.fn(async () => ({}))
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    controller.activate(makeRuntime())
    // 始终未绑定 handlers:ready 挂起中
    const readyRejection = expect(controller.api.ready).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    const inflight = callFacade(controller.api, 'objects.list', undefined)
    const inflightRejection = expect(inflight).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    controller.dispose()
    await readyRejection
    await inflightRejection
    await expect(
      callFacade(controller.api, 'objects.list', undefined),
    ).rejects.toMatchObject({code: 'API_DISPOSED'})
    await expect(controller.api.ready).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    expect(() => controller.api.describe()).toThrow(
      expect.objectContaining({code: 'API_DISPOSED'}) as never,
    )
    expect(execute).not.toHaveBeenCalled()
  })

  test('dispose 收尾:pending placement/camera/anchor waiter 以 API_DISPOSED 拒绝,在途任务硬取消为 cancelled', async () => {
    const controller = createCameraStudioApi()
    const runtime = makeRuntime()
    controller.activate(runtime)
    const persisted = createPlacementWaiter('m1')
    const cameraMounted = createCameraWaiter('c1')
    const anchorMounted = createAnchorWaiter('a1')
    const persistedRejection = expect(persisted).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    const cameraRejection = expect(cameraMounted).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    const anchorRejection = expect(anchorMounted).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    // 在途任务:execute 监听 signal(生产 exporter 同款),dispose abort 后收尾
    const {done} = runtime.jobs.start<never>({
      kind: 'test',
      cancelable: true,
      execute: ({signal}) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new AgentApiError('JOB_CANCELLED', '已中止')),
          )
        }),
    })
    controller.dispose()
    await persistedRejection
    await cameraRejection
    await anchorRejection
    const snapshot = await done
    expect(snapshot.state).toBe('cancelled')
    expect(snapshot.error?.code).toBe('API_DISPOSED')
  })

  test('代次替换:旧代次未 settle 的 ready 以 API_NOT_READY 拒绝(不悬挂)', async () => {
    const runtime = makeRuntime()
    const rejection = expect(runtime.ready).rejects.toMatchObject({
      code: 'API_NOT_READY',
    })
    runtime.activate()
    await rejection
  })

  test('handler 解绑使就绪失效:api.ready 换新 promise 并挂起;间隙中的调用挂起,重绑后继续', async () => {
    const execute = jest.fn(async (name: string, args: unknown) => ({
      echo: name,
      received: args,
    }))
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    controller.activate(makeRuntime())
    const unbind1 = controller.bindSceneHandlers({})!
    const ready1 = controller.api.ready
    await ready1

    // 解绑(CameraScene 卸载路径):旧代次失效,api.ready 换新 promise
    unbind1()
    const ready2 = controller.api.ready
    expect(ready2).not.toBe(ready1)
    await expectPending(ready2)
    // 间隙中的调用捕获新代次并挂起
    const inflight = callFacade(controller.api, 'scene.getSnapshot', undefined)
    await expectPending(inflight)
    expect(execute).not.toHaveBeenCalled()

    // 重绑(CameraScene 重挂载):新代次 ready,挂起调用继续
    const unbind2 = controller.bindSceneHandlers({})!
    await ready2
    await expect(inflight).resolves.toEqual({
      echo: 'scene.getSnapshot',
      received: undefined,
    })
    unbind2()
    controller.dispose()
  })

  test('会话拆解后重激活(initPromise 复用的 remount):新代次重新 ready,旧代次 promise 不写入新 runtime', async () => {
    const execute = jest.fn(async (name: string) => ({echo: name}))
    const controller = createCameraStudioApi({
      buildRegistry: stubRegistryFactory(execute),
    })
    controller.activate(makeRuntime())
    // 旧代次已捕获的 promise(未绑定,挂起中)
    const oldReady = controller.api.ready
    const oldRejection = expect(oldReady).rejects.toMatchObject({
      code: 'API_DISPOSED',
    })
    controller.dispose()
    await oldRejection

    // 重挂:新 runtime、新代次
    controller.activate(makeRuntime())
    const newReady = controller.api.ready
    expect(newReady).not.toBe(oldReady)
    await expectPending(newReady)
    const unbind = controller.bindSceneHandlers({})!
    await newReady
    // 旧 promise 保持已拒绝状态,未被新 runtime 改写
    await expect(oldReady).rejects.toMatchObject({code: 'API_DISPOSED'})
    // 新代次命令可用
    await expect(
      callFacade(controller.api, 'scene.getSnapshot', undefined),
    ).resolves.toEqual({echo: 'scene.getSnapshot'})
    unbind()
    controller.dispose()
  })

  test('未激活(首 boot 进行中):ready 挂起,describe 以 API_NOT_READY 失败', async () => {
    const controller = createCameraStudioApi()
    await expectPending(controller.api.ready)
    expect(() => controller.api.describe()).toThrow(
      expect.objectContaining({code: 'API_NOT_READY'}) as never,
    )
  })
})

// ── suite 3:公开导出、全局暴露与 CameraFlows 兼容 ───────────────
function mountHost(
  config: CameraStudioConfig,
  probe: (handle: CameraStudioHandle) => void,
) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  const Harness = () => {
    const handle = useCameraStudio(config)
    probe(handle)
    return handle.ready ? <CameraScene {...handle.sceneProps} /> : null
  }
  return {
    async mount() {
      await act(async () => {
        root.render(<Harness />)
      })
      await act(async () => {}) // 冲刷 boot 微任务与库条目等异步 effect
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      el.remove()
    },
  }
}

test('宿主集成:api 首帧即稳定,ready 后挂 window,dispose 删除;CameraFlows 八方法兼容且 onFlows 只触发一次', async () => {
  const seenApis: CameraStudioApi[] = []
  const onFlows = jest.fn()
  const host = mountHost(
    {storage: false, agent: {exposeGlobal: true}, flows: {onFlows}},
    (handle) => {
      seenApis.push(handle.api)
    },
  )
  await host.mount()

  // 模块级单例:首帧与后续 render 同一 api 对象
  expect(seenApis.length).toBeGreaterThan(0)
  expect(seenApis.every((api) => api === seenApis[0])).toBe(true)
  const api = seenApis[0]

  await act(async () => {
    await api.ready
  })
  // exposeGlobal:true 且场景 ready → 挂载 window 全局
  expect((window as any).__cameraStudioApi).toBe(api)
  // 真实注册表 + 真实运行时端到端:facade → 命令 → 无副作用查询
  await expect(api.scene.getSnapshot()).resolves.toEqual({
    revision: 1,
    objects: [],
  })
  expect(
    api
      .describe()
      .commands.map((c) => c.name)
      .sort(),
  ).toEqual(FACADE_COMMANDS.map((row) => row.command).sort())

  // CameraFlows 兼容:八方法签名不变,onFlows 只触发一次
  expect(onFlows).toHaveBeenCalledTimes(1)
  const flows = onFlows.mock.calls[0][0] as CameraFlows
  for (const key of [
    'startPlacingModel',
    'placeModelAt',
    'addPresetPath',
    'addCamera',
    'addAnchor',
    'cancelPlacing',
    'importModel',
    'dropPointFromClient',
  ] as const) {
    expect(typeof flows[key]).toBe('function')
  }
  // 场景未捕获 drop context 时返回 null(既有语义)
  expect(flows.dropPointFromClient(0, 0)).toBeNull()
  expect(getHostFlowsHandle()).toBe(flows)

  // CameraScene 生产绑定:完整 handler 集绑进当前代次
  const runtime = apiInternals.getActiveAgentRuntime()
  expect(runtime).toBeDefined()
  for (const key of HANDLER_KEYS) {
    expect(typeof runtime!.handlers[key]).toBe('function')
  }

  // Task 10 决策(生产绑定复核):createCamera 不自动设活动相机,
  // 显式 setActiveCamera 才切换;清单里 cam-1 顺位为初始活动
  expect(runtime!.handlers.getViewState!().activeCameraKey).toBe('cam-1')
  await act(async () => {
    runtime!.handlers.createCamera!({})
  })
  expect(addCameraToRegistrySpy).toHaveBeenCalledWith(
    fakeSheet,
    {cameraKey: 'cam-new'},
    undefined,
  )
  expect(runtime!.handlers.getViewState!().activeCameraKey).toBe('cam-1')
  await act(async () => {
    runtime!.handlers.setActiveCamera!({cameraKey: 'cam-new'})
  })
  expect(runtime!.handlers.getViewState!().activeCameraKey).toBe('cam-new')

  // 卸载:window 全局删除、flows 注册表清空、onFlows 不重发、调用 API_DISPOSED
  await host.unmount()
  expect((window as any).__cameraStudioApi).toBeUndefined()
  expect(getHostFlowsHandle()).toBeNull()
  expect(onFlows).toHaveBeenCalledTimes(1)
  await expect(api.scene.getSnapshot()).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
})

test('exposeGlobal 缺省/关闭:场景 ready 后 window 上也没有 __cameraStudioApi', async () => {
  const controller = createCameraStudioApi()
  controller.activate(makeRuntime(), {exposeGlobal: false})
  const unbind = controller.bindSceneHandlers({})!
  await controller.api.ready
  await tick()
  expect((window as any).__cameraStudioApi).toBeUndefined()
  unbind()
  controller.dispose()
})

test('exposeGlobal 开启但拆解先于 ready:window 永不挂载', async () => {
  const controller = createCameraStudioApi()
  controller.activate(makeRuntime(), {exposeGlobal: true})
  controller.dispose()
  await tick()
  expect((window as any).__cameraStudioApi).toBeUndefined()
})
