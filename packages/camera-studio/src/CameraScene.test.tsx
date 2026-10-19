/*
 * @jest-environment jsdom
 */
/**
 * CameraScene 组件化(T9):
 *  1. project 走 prop(组件内不再 getProject('Space')),onFlows 经
 *     真实 HostFlowsWiring 交付;
 *  2. i18n 嵌套判定(spec §7):宿主已包 I18nProvider → 跳过自包、
 *     ui.locale 不生效;无宿主 provider → 自包并应用 ui.locale。
 *
 * 整树渲染的代价控制:Canvas 替身直接丢弃子树(Canvas 内组件不进 jsdom,
 * 也不用伪造 three 运行时);注册表/PlacementManager/poseSession/
 * videoExport 逐项 doMock 成良性替身,组件体与其余真实子树
 * (TopToolbar/hostFlows/menuModel…)全量执行。与
 * App.hostFlows.test.tsx / bootstrap.test.tsx 同套 doMock 手法
 * (jest-esbuild 不提升 jest.mock,doMock 先行登记)。
 */
import React from 'react'
import type {ReactElement, ReactNode} from 'react'
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import {IDBFactory} from 'fake-indexeddb'
import {
  I18nProvider,
  getLanguage,
  setLanguage,
  useI18n,
} from '@dreamerbird/studio/i18n'
import {getHostFlowsHandle} from './hostFlows'
import {setUiConfig} from './uiConfig'
import type {CameraSceneProps} from './config'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as any).indexedDB = new IDBFactory()
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()
// pipLayout 的 effect 用 ResizeObserver(jsdom 无此 API),补空实现
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// getProject 间谍:断言组件内不再调(T9 后 project 一律来自 prop)
const mockGetProject = jest.fn()
// core 其余导出保持真实(模块链里 resolvePropLabel 等仍要用)
jest.doMock('@dreamerbird/core', () => {
  const actual = jest.requireActual('@dreamerbird/core')
  return {
    ...actual,
    getProject: mockGetProject,
    getStudioSync: () => undefined,
    onChange: () => () => {},
    val: (x: unknown) => x,
  }
})
jest.doMock('@dreamerbird/react', () => ({
  __esModule: true,
  usePrism: (fn: () => unknown) => fn(),
  useVal: () => undefined,
}))
// Canvas 替身:丢弃子树——Canvas 内组件(SheetProvider/Model/EnvLighting…)
// 依赖 r3f 包内嵌的另一份 @react-three/fiber 副本,doMock 够不到,也不
// 值得伪造 three 运行时;本文件断言全在 Canvas 外。其余 fiber 导出仅为
// 真实模块 import 期绑定,渲染期不被调用
jest.doMock('@react-three/fiber', () => ({
  __esModule: true,
  Canvas: () => React.createElement('div', {'data-testid': 'canvas-fake'}),
  useFrame: () => {},
  useThree: () => ({}),
}))
// TopToolbar 替身:它不承载本文件的断言(project/onFlows/i18n),但其
// 链条里的 studio ToolbarIconButton 依赖 react-merge-refs——jest 把
// 'react-merge-refs' 与 '*.glb' 都映射到 identity-obj-proxy(同一模块
// ID),doMock 按解析后 ID 登记会互相覆盖(scene.glb 的 doMock 会顶掉
// mergeRefs 替身),与其 hack 混合替身不如整模块替身。TopToolbar 自有
// TopToolbar.test.tsx 覆盖。
jest.doMock('./TopToolbar', () => ({
  __esModule: true,
  TopToolbar: () => null,
}))
jest.doMock('./scene.glb', () => 'scene.glb')
jest.doMock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: class RoomEnvironment {},
}))
const noop = () => {}
const noopComponent = () => null
jest.doMock('./PlacementManager', () => ({
  __esModule: true,
  PlacementRig: noopComponent,
  PlacementRigErrorBoundary: class extends React.Component<{
    children?: ReactNode
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
    placeLibraryEntryAt: noop,
    cancelPlacing: noop,
    confirmPlacing: noop,
    clearPending: noop,
  }),
  usePlacementSurface: noop,
  useSelectionGizmoTarget: noop,
}))
jest.doMock('./cameraRegistry', () => ({
  __esModule: true,
  addCameraToRegistry: noop,
  getCamerasRegistry: () => ({}),
  nextCameraEntry: () => ({cameraKey: 'cam-1'}),
  readCameraEntries: () => [],
  removeCamera: noop,
  // 与真实现同语义:活动 key 在清单里取之,否则顺位第一台,空清单 null
  resolveActiveCamera: (
    cameras: Array<{cameraKey: string}>,
    key: string | null,
  ) => cameras.find((e) => e.cameraKey === key) ?? cameras[0] ?? null,
  useCamerasList: () => [],
}))
jest.doMock('./anchorsRegistry', () => ({
  __esModule: true,
  addAnchorToRegistry: noop,
  nextAnchorKey: () => 'anchor-1',
  removeAnchor: noop,
  useAnchorsList: () => [],
}))
jest.doMock('./pathRegistry', () => ({
  __esModule: true,
  addPathToRegistry: noop,
  nextPathEntry: () => ({pathKey: 'path-1'}),
  readPathEntries: () => [],
  getPathsRegistry: () => ({}),
  removePathFromRegistry: noop,
  usePathsList: () => [],
}))
jest.doMock('./CameraPath', () => ({
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
jest.doMock('./poseMode/poseSession', () => ({
  __esModule: true,
  enterPoseSession: noop,
  getPoseSession: () => null,
  isModelDoubleClick: () => false,
  poseHitTest: () => false,
  requestPoseExit: noop,
  usePoseSessionKey: () => null,
}))
jest.doMock('./videoExport/sinks', () => ({
  __esModule: true,
  listSinks: () => [],
}))
jest.doMock('./videoExport/exporter', () => ({
  __esModule: true,
  startShotExport: () => null,
}))

const {CameraScene, SceneI18nRoot} = require('./CameraScene') as {
  CameraScene: (props: CameraSceneProps) => ReactElement
  SceneI18nRoot: (props: {children?: ReactNode}) => ReactElement
}

/** 最小 IProject/sheet 替身:组件体只触 address/sheet('Scene')/sequence 形状 */
const fakeSheet = {
  address: {projectId: 'proj-x', sheetId: 'Scene', sheetInstanceId: 'default'},
  sequence: {pointer: {playing: {}}},
}
const fakeProject = {sheet: jest.fn(() => fakeSheet)}

async function renderScene(props: CameraSceneProps): Promise<{
  root: ReturnType<typeof ReactDOM.createRoot>
  el: HTMLElement
}> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  await act(async () => {
    root.render(<CameraScene {...props} />)
  })
  await act(async () => {}) // 冲刷库条目等异步 effect
  return {root, el}
}

afterEach(() => {
  setUiConfig({})
  setLanguage('en')
  mockGetProject.mockClear()
  fakeProject.sheet.mockClear()
  globalThis.localStorage?.clear()
})

// ── 1. project 走 prop + onFlows 交付 ──────────────────────────
test('project 走 prop,不再 getProject(Space);onFlows 经 HostFlowsWiring 交付', async () => {
  const onFlows = jest.fn()
  const {root, el} = await renderScene({project: fakeProject as never, onFlows})
  // T9 核心断言:组件内不再自己 getProject,project 由 prop 注入
  expect(mockGetProject).not.toHaveBeenCalled()
  expect(fakeProject.sheet).toHaveBeenCalledWith('Scene')
  // 宿主接线:真实 HostFlowsWiring 交付句柄并挂注册表
  expect(onFlows).toHaveBeenCalledTimes(1)
  const flows = onFlows.mock.calls[0][0]
  expect(getHostFlowsHandle()).toBe(flows)
  // 场景根与 Canvas 替身都在(document 结构健全)
  expect(el.querySelector('[data-testid="canvas-fake"]')).not.toBeNull()
  await act(async () => {
    root.unmount()
  })
  el.remove()
  expect(getHostFlowsHandle()).toBeNull()
})

// ── 2. i18n 嵌套判定(SceneI18nRoot)────────────────────────────
/** 渲染期把所在层的 i18n context 值抓出来(引用比较用) */
function Capture({into}: {into: (v: unknown) => void}) {
  into(useI18n())
  return null
}

test('宿主已包 I18nProvider 时跳过自包:context 同一引用,ui.locale 不生效', async () => {
  const before = getLanguage()
  setUiConfig({locale: 'zh-CN'})
  let hostValue: unknown
  let probeValue: unknown
  const el = document.createElement('div')
  const root = ReactDOM.createRoot(el)
  await act(async () => {
    root.render(
      <I18nProvider>
        <Capture into={(v) => (hostValue = v)} />
        <SceneI18nRoot>
          <Capture into={(v) => (probeValue = v)} />
        </SceneI18nRoot>
      </I18nProvider>,
    )
  })
  // 同一 context 对象 = SceneI18nRoot 中间没插第二层 provider
  expect(probeValue).toBe(hostValue)
  // 语言以宿主为准:ui.locale 在宿主已包分支不生效
  expect(getLanguage()).toBe(before)
  await act(async () => {
    root.unmount()
  })
  el.remove()
})

test('无宿主 provider 时自包一层并应用 ui.locale', async () => {
  setUiConfig({locale: 'zh-CN'})
  let rootValue: unknown
  let probeValue: unknown
  const el = document.createElement('div')
  const root = ReactDOM.createRoot(el)
  await act(async () => {
    root.render(
      <React.Fragment>
        <Capture into={(v) => (rootValue = v)} />
        <SceneI18nRoot>
          <Capture into={(v) => (probeValue = v)} />
        </SceneI18nRoot>
      </React.Fragment>,
    )
  })
  // 外层裸 useI18n() 拿的是模块级 fallbackValue(context 默认 null,
  // T9 改 i18n 嵌套检测后如此);内层不同引用 = SceneI18nRoot 自包了一层 provider
  expect(probeValue).not.toBe(rootValue)
  expect(probeValue).toBeTruthy()
  // ui.locale 在自包分支生效(studio i18n 单例,全局应用)
  expect(getLanguage()).toBe('zh-CN')
  await act(async () => {
    root.unmount()
  })
  el.remove()
})
