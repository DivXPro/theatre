/**
 * view / ui 命令(2026-10-17,Task 12):
 * view.getState / setShotView / setPipVisible / orbit / pan / dolly / reset
 * + ui.hide / restore / setLeftStripHidden / openPanel / closePanel /
 * setGizmoMode。
 *
 * 全部 session 域、undoable:none(spec 9 view/ui 行 + 8.6.4:视图/UI 会话
 * 操作不进撤销)。视图会话态与面板/gizmo 经 Scene Runtime handler
 * (生产由 CameraScene 绑定,Task 15 接线;测试用假 handler,形状与接线
 * 后的绑定一致);orbit/pan/dolly/reset 转发到 directorView 模块注册的
 * 导演控制器(MainOrbitControls 挂载时登记),未注册返回 API_NOT_READY,
 * 不静默成功。studio 显隐走公开 studio.ui 方法。
 *
 * 布景同 selection.test.ts:真实 core project/sheet + 注入式假 studio
 * (runtime.getStudio),node 环境,无需 doMock。
 */
import {getProject} from '@dreamerbird/core'
import type {IStudio} from '@dreamerbird/core'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import type {AgentRuntime} from '../runtime'
import {getDirectorView, registerDirectorView} from '../runtime/directorView'
import type {DirectorViewController} from '../runtime/directorView'
import type {CommandContext} from '../types'
import {registerUiCommands} from './ui'
import {registerViewCommands} from './view'

let projectSeq = 0

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

function makeScene({withStudio = true}: {withStudio?: boolean} = {}) {
  const project = getProject(`agent-view-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const ui = {
    hide: jest.fn(),
    restore: jest.fn(),
    isHidden: false,
    setLeftStripHidden: jest.fn(),
  }
  const studio = {ui}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => (withStudio ? (studio as unknown as IStudio) : undefined),
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerViewCommands(registry, runtime)
  registerUiCommands(registry, runtime)
  cleanups.push(() => runtime.dispose())
  return {project, sheet, registry, runtime, ui}
}

/** 绑定 CameraScene 侧的视图会话 handler(假实现,形状同生产绑定) */
function bindViewHandlers(
  runtime: AgentRuntime,
  state: {
    activeCameraKey: string | null
    shotView: boolean
    pipVisible: boolean
    editingPath: string | null
    gizmoMode: 'select' | 'translate' | 'rotate' | 'scale'
  },
) {
  const setShotView = jest.fn()
  const setPipVisible = jest.fn()
  cleanups.push(
    runtime.bindHandlers({
      getViewState: () => state,
      setShotView,
      setPipVisible,
    }),
  )
  return {setShotView, setPipVisible}
}

/** 登记导演控制器假实现(MainOrbitControls 生产登记的同形状替身) */
function registerFakeController() {
  const controller: DirectorViewController = {
    orbit: jest.fn(),
    pan: jest.fn(),
    dolly: jest.fn(),
    reset: jest.fn(),
  }
  cleanups.push(registerDirectorView(controller))
  return controller
}

// ── view.getState ──────────────────────────────────────────────

test('view.getState 返回活动相机/镜头视角/PIP/路径编辑/gizmo/studio 显隐', async () => {
  const {registry, runtime, ui} = makeScene()
  ui.isHidden = true
  bindViewHandlers(runtime, {
    activeCameraKey: 'Cam 1',
    shotView: true,
    pipVisible: false,
    editingPath: 'Fly Around',
    gizmoMode: 'rotate',
  })
  const state = await registry.execute('view.getState', {}, ctx())
  expect(state).toEqual({
    activeCameraKey: 'Cam 1',
    shotView: true,
    pipVisible: false,
    editingPath: 'Fly Around',
    gizmoMode: 'rotate',
    studioHidden: true,
  })
})

test('view.getState 无活动相机/未编辑路径时回 null 字段', async () => {
  const {registry, runtime} = makeScene()
  bindViewHandlers(runtime, {
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
  })
  const state = await registry.execute('view.getState', {}, ctx())
  expect(state).toEqual({
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
    studioHidden: false,
  })
})

test('view.getState 视图 handler 未绑定返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('view.getState', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
})

test('view.getState Studio 不可用返回 SCENE_UNAVAILABLE', async () => {
  const {registry, runtime} = makeScene({withStudio: false})
  bindViewHandlers(runtime, {
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
  })
  await expect(
    registry.execute('view.getState', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
})

// ── view.setShotView / setPipVisible ───────────────────────────

test('view.setShotView 转发到 Scene Runtime handler', async () => {
  const {registry, runtime} = makeScene()
  const {setShotView} = bindViewHandlers(runtime, {
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
  })
  await registry.execute('view.setShotView', {on: true}, ctx())
  expect(setShotView).toHaveBeenCalledWith({on: true})
})

test('view.setPipVisible 转发到 Scene Runtime handler', async () => {
  const {registry, runtime} = makeScene()
  const {setPipVisible} = bindViewHandlers(runtime, {
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
  })
  await registry.execute('view.setPipVisible', {visible: false}, ctx())
  expect(setPipVisible).toHaveBeenCalledWith({visible: false})
})

test('view.setShotView 非布尔参数返回 INVALID_ARGUMENT,不触达 handler', async () => {
  const {registry, runtime} = makeScene()
  const {setShotView} = bindViewHandlers(runtime, {
    activeCameraKey: null,
    shotView: false,
    pipVisible: true,
    editingPath: null,
    gizmoMode: 'select',
  })
  await expect(
    registry.execute('view.setShotView', {on: 'yes'}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(setShotView).not.toHaveBeenCalled()
})

test('view.setPipVisible handler 未绑定返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('view.setPipVisible', {visible: true}, ctx()),
  ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
})

// ── view.orbit / pan / dolly / reset ───────────────────────────

test('view.orbit 转发到已注册导演控制器', async () => {
  const {registry} = makeScene()
  const controller = registerFakeController()
  await registry.execute('view.orbit', {deltaTheta: 0.3, deltaPhi: -0.1}, ctx())
  expect(controller.orbit).toHaveBeenCalledWith({
    deltaTheta: 0.3,
    deltaPhi: -0.1,
  })
})

test('view.pan / dolly / reset 转发到已注册导演控制器', async () => {
  const {registry} = makeScene()
  const controller = registerFakeController()
  await registry.execute('view.pan', {deltaX: 1.5, deltaY: -2}, ctx())
  await registry.execute('view.dolly', {delta: 3}, ctx())
  await registry.execute('view.reset', {}, ctx())
  expect(controller.pan).toHaveBeenCalledWith({deltaX: 1.5, deltaY: -2})
  expect(controller.dolly).toHaveBeenCalledWith({delta: 3})
  expect(controller.reset).toHaveBeenCalledTimes(1)
})

test('导演控制器未注册时 orbit/pan/dolly/reset 返回 API_NOT_READY', async () => {
  const {registry} = makeScene()
  expect(getDirectorView()).toBeUndefined()
  await expect(
    registry.execute('view.orbit', {deltaTheta: 0.1, deltaPhi: 0}, ctx()),
  ).rejects.toMatchObject({code: 'API_NOT_READY'})
  await expect(
    registry.execute('view.pan', {deltaX: 1, deltaY: 0}, ctx()),
  ).rejects.toMatchObject({code: 'API_NOT_READY'})
  await expect(
    registry.execute('view.dolly', {delta: 1}, ctx()),
  ).rejects.toMatchObject({code: 'API_NOT_READY'})
  await expect(registry.execute('view.reset', {}, ctx())).rejects.toMatchObject(
    {
      code: 'API_NOT_READY',
    },
  )
})

test('orbit/pan/dolly 拒绝非有限数字,不触达控制器', async () => {
  const {registry} = makeScene()
  const controller = registerFakeController()
  await expect(
    registry.execute('view.orbit', {deltaTheta: NaN, deltaPhi: 0}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  await expect(
    registry.execute('view.orbit', {deltaTheta: 0, deltaPhi: Infinity}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  await expect(
    registry.execute('view.pan', {deltaX: 0, deltaY: -Infinity}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  await expect(
    registry.execute('view.dolly', {delta: Number.NaN}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(controller.orbit).not.toHaveBeenCalled()
  expect(controller.pan).not.toHaveBeenCalled()
  expect(controller.dolly).not.toHaveBeenCalled()
})

// ── ui.hide / restore / setLeftStripHidden ─────────────────────

test('ui.hide / restore / setLeftStripHidden 走公开 studio.ui 方法', async () => {
  const {registry, ui} = makeScene()
  await registry.execute('ui.hide', {}, ctx())
  await registry.execute('ui.restore', {}, ctx())
  await registry.execute('ui.setLeftStripHidden', {hidden: true}, ctx())
  expect(ui.hide).toHaveBeenCalledTimes(1)
  expect(ui.restore).toHaveBeenCalledTimes(1)
  expect(ui.setLeftStripHidden).toHaveBeenCalledWith(true)
})

test('Studio 不可用时 ui.hide / restore / setLeftStripHidden 返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene({withStudio: false})
  await expect(registry.execute('ui.hide', {}, ctx())).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
  await expect(registry.execute('ui.restore', {}, ctx())).rejects.toMatchObject(
    {
      code: 'SCENE_UNAVAILABLE',
    },
  )
  await expect(
    registry.execute('ui.setLeftStripHidden', {hidden: true}, ctx()),
  ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
})

test('ui.setLeftStripHidden 非布尔参数返回 INVALID_ARGUMENT', async () => {
  const {registry, ui} = makeScene()
  await expect(
    registry.execute('ui.setLeftStripHidden', {hidden: 1}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(ui.setLeftStripHidden).not.toHaveBeenCalled()
})

// ── ui.openPanel / closePanel ──────────────────────────────────

test('ui.openPanel / closePanel 转发 model|pose|animation|path 到 handler', async () => {
  const {registry, runtime} = makeScene()
  const openPanel = jest.fn()
  const closePanel = jest.fn()
  cleanups.push(runtime.bindHandlers({openPanel, closePanel}))
  for (const panel of ['model', 'pose', 'animation', 'path'] as const) {
    await registry.execute('ui.openPanel', {panel}, ctx())
    await registry.execute('ui.closePanel', {panel}, ctx())
  }
  expect(openPanel.mock.calls).toEqual([
    [{panel: 'model'}],
    [{panel: 'pose'}],
    [{panel: 'animation'}],
    [{panel: 'path'}],
  ])
  expect(closePanel.mock.calls).toEqual([
    [{panel: 'model'}],
    [{panel: 'pose'}],
    [{panel: 'animation'}],
    [{panel: 'path'}],
  ])
})

test('ui.openPanel / closePanel 拒绝未知面板名', async () => {
  const {registry, runtime} = makeScene()
  const openPanel = jest.fn()
  const closePanel = jest.fn()
  cleanups.push(runtime.bindHandlers({openPanel, closePanel}))
  await expect(
    registry.execute('ui.openPanel', {panel: 'assets'}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  await expect(
    registry.execute('ui.closePanel', {panel: ''}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(openPanel).not.toHaveBeenCalled()
  expect(closePanel).not.toHaveBeenCalled()
})

test('ui.openPanel handler 未绑定返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('ui.openPanel', {panel: 'model'}, ctx()),
  ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
})

// ── ui.setGizmoMode ────────────────────────────────────────────

test('ui.setGizmoMode 接受 select|translate|rotate|scale 并转发', async () => {
  const {registry, runtime} = makeScene()
  const setGizmoMode = jest.fn()
  cleanups.push(runtime.bindHandlers({setGizmoMode}))
  for (const mode of ['select', 'translate', 'rotate', 'scale'] as const) {
    await registry.execute('ui.setGizmoMode', {mode}, ctx())
  }
  expect(setGizmoMode.mock.calls).toEqual([
    [{mode: 'select'}],
    [{mode: 'translate'}],
    [{mode: 'rotate'}],
    [{mode: 'scale'}],
  ])
})

test('ui.setGizmoMode 拒绝未知模式,不触达 handler', async () => {
  const {registry, runtime} = makeScene()
  const setGizmoMode = jest.fn()
  cleanups.push(runtime.bindHandlers({setGizmoMode}))
  await expect(
    registry.execute('ui.setGizmoMode', {mode: 'fly'}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(setGizmoMode).not.toHaveBeenCalled()
})

test('ui.setGizmoMode handler 未绑定返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('ui.setGizmoMode', {mode: 'select'}, ctx()),
  ).rejects.toMatchObject({code: 'SCENE_UNAVAILABLE'})
})

// ── 会话销毁与元数据 ───────────────────────────────────────────

test('会话销毁后 view/ui 命令返回 API_DISPOSED', async () => {
  const {registry, runtime} = makeScene()
  registerFakeController()
  runtime.dispose()
  await expect(
    registry.execute('view.getState', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
  await expect(
    registry.execute('view.orbit', {deltaTheta: 0.1, deltaPhi: 0}, ctx()),
  ).rejects.toMatchObject({code: 'API_DISPOSED'})
  await expect(registry.execute('ui.hide', {}, ctx())).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
})

test('describe() 中 view/ui 命令全部 session 域、undoable:none', () => {
  const {registry} = makeScene()
  const byName = new Map(registry.describe().commands.map((c) => [c.name, c]))
  const expected: Record<string, 'query' | 'mutation'> = {
    'view.getState': 'query',
    'view.setShotView': 'mutation',
    'view.setPipVisible': 'mutation',
    'view.orbit': 'mutation',
    'view.pan': 'mutation',
    'view.dolly': 'mutation',
    'view.reset': 'mutation',
    'ui.hide': 'mutation',
    'ui.restore': 'mutation',
    'ui.setLeftStripHidden': 'mutation',
    'ui.openPanel': 'mutation',
    'ui.closePanel': 'mutation',
    'ui.setGizmoMode': 'mutation',
  }
  for (const [name, kind] of Object.entries(expected)) {
    const command = byName.get(name)
    expect(command).toBeDefined()
    expect(command).toMatchObject({
      kind,
      stateDomain: 'session',
      undoable: 'none',
    })
  }
})
