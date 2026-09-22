/*
 * @jest-environment jsdom
 */
/**
 * hostFlows:宿主能力句柄的基础设施——句柄注册表、placing 外部 store、
 * usePlacing hook。模块级单例,场景 mount 时挂句柄、卸载时清句柄。
 */
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import React from 'react'
import {PerspectiveCamera} from 'three'
import type {ModelEntry} from './assetLibrary/types'
import type {PlacingState} from './PlacementManager'
import {
  createHostFlows,
  dropPointFromClient,
  getHostFlowsHandle,
  getPlacingSnapshot,
  pickerToggleHandler,
  setDropPointContext,
  setHostFlowsHandle,
  setPlacingSnapshot,
  subscribePlacing,
  usePlacing,
} from './hostFlows'
import type {HostFlowDeps} from './hostFlows'

const placingA: PlacingState = {
  url: 'blob:a',
  label: 'A',
  source: {type: 'library', entryId: 'e1'},
}

afterEach(() => {
  setHostFlowsHandle(null)
  setPlacingSnapshot(null)
})

describe('句柄注册表', () => {
  it('未设置时返回 null,设置后可取回,清空后归 null', () => {
    expect(getHostFlowsHandle()).toBeNull()
    const fake = {} as never
    setHostFlowsHandle(fake)
    expect(getHostFlowsHandle()).toBe(fake)
    setHostFlowsHandle(null)
    expect(getHostFlowsHandle()).toBeNull()
  })
})

describe('placing store', () => {
  it('初始快照为 null', () => {
    expect(getPlacingSnapshot()).toBeNull()
  })
  it('设置快照后订阅者被通知;同值重复设置不通知', () => {
    const seen: Array<PlacingState | null> = []
    const unsub = subscribePlacing(() => seen.push(getPlacingSnapshot()))
    setPlacingSnapshot(placingA)
    setPlacingSnapshot(placingA)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(placingA)
    unsub()
    setPlacingSnapshot(null)
    expect(seen).toHaveLength(1)
  })
})

describe('usePlacing', () => {
  it('跟随 store 变化重渲染', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = ReactDOM.createRoot(el)
    let rendering: () => PlacingState | null = () => null
    function Probe() {
      rendering = usePlacing
      return null
    }
    function Host() {
      const placing = usePlacing()
      rendering = () => placing
      return null
    }
    await act(async () => {
      root.render(React.createElement(Host))
    })
    expect(rendering()).toBeNull()
    await act(async () => {
      setPlacingSnapshot(placingA)
    })
    expect(rendering()).toBe(placingA)
    await act(async () => {
      root.unmount()
    })
    el.remove()
    // Probe 只为引用 usePlacing 而设,避免 lint 报未使用
    void Probe
  })
})

describe('dropPointFromClient', () => {
  afterEach(() => setDropPointContext(null))
  it('未设置上下文时返回 null', () => {
    expect(dropPointFromClient(50, 50)).toBeNull()
  })
  it('上下文就绪时按地面兜底规则返回落点(rect 中心的垂直射线打 y=0)', () => {
    // 相机在 (0,10,1) 看向原点,rect 100×100,(50,50) = NDC 原点,
    // 中心视线恰好穿过 (0,0,0)。不能放正上方 (0,10,0):lookAt 的
    // up 与视线平行会触发 three 退化回退,给方向引入 ~1e-3 扰动。
    const camera = new PerspectiveCamera()
    camera.position.set(0, 10, 1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const domElement = {
      getBoundingClientRect: () =>
        ({left: 0, top: 0, width: 100, height: 100}) as DOMRect,
    } as unknown as HTMLElement
    setDropPointContext({
      gl: {domElement} as never,
      camera,
    })
    const p = dropPointFromClient(50, 50)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(0, 5)
    expect(p!.z).toBeCloseTo(0, 5)
    expect(p!.y).toBeCloseTo(0, 5)
  })
  it('清空上下文后回到 null', () => {
    const camera = new PerspectiveCamera()
    setDropPointContext({
      gl: {
        domElement: {
          getBoundingClientRect: () =>
            ({left: 0, top: 0, width: 100, height: 100}) as DOMRect,
        },
      } as never,
      camera,
    })
    setDropPointContext(null)
    expect(dropPointFromClient(50, 50)).toBeNull()
  })
})

function makeDeps(): HostFlowDeps & Record<string, jest.Mock> {
  return {
    startPlacingFromLibrary: jest.fn(async () => undefined),
    placeLibraryEntryAt: jest.fn(),
    placePresetPath: jest.fn(),
    addCamera: jest.fn(),
    addAnchor: jest.fn(),
    cancelPlacing: jest.fn(),
    importModel: jest.fn(async () => ({id: 'm1'}) as unknown as ModelEntry),
  }
}
const entry = {id: 'e1', name: 'A'} as unknown as ModelEntry
const preset = {id: 'p1'} as never

describe('createHostFlows', () => {
  it('七个动作逐一转发到注入的 deps,dropPointFromClient 挂上模块实现', async () => {
    const deps = makeDeps()
    const flows = createHostFlows(deps)
    await flows.startPlacingModel(entry)
    expect(deps.startPlacingFromLibrary).toHaveBeenCalledWith(entry)
    flows.placeModelAt(entry, {x: 1, y: 2, z: 3})
    expect(deps.placeLibraryEntryAt).toHaveBeenCalledWith(entry, {
      x: 1,
      y: 2,
      z: 3,
    })
    flows.addPresetPath(preset, {x: 0, y: 5, z: 0})
    expect(deps.placePresetPath).toHaveBeenCalledWith(preset, {
      x: 0,
      y: 5,
      z: 0,
    })
    flows.addCamera()
    expect(deps.addCamera).toHaveBeenCalled()
    flows.addAnchor()
    expect(deps.addAnchor).toHaveBeenCalled()
    flows.cancelPlacing()
    expect(deps.cancelPlacing).toHaveBeenCalled()
    const file = new File(['x'], 'm.fbx')
    await flows.importModel(file)
    expect(deps.importModel).toHaveBeenCalledWith(file)
    // 未设 dropPoint 上下文时按模块实现返 null
    expect(flows.dropPointFromClient(0, 0)).toBeNull()
  })
})

describe('pickerToggleHandler', () => {
  it('宿主回调存在时只调宿主回调,toggleFrame 不执行', () => {
    const hostCb = jest.fn()
    const toggleFrame = jest.fn()
    pickerToggleHandler(hostCb, toggleFrame, 'model')()
    expect(hostCb).toHaveBeenCalledTimes(1)
    expect(toggleFrame).not.toHaveBeenCalled()
  })
  it('宿主回调缺省时走 toggleFrame(kind)', () => {
    const toggleFrame = jest.fn()
    pickerToggleHandler(undefined, toggleFrame, 'path')()
    expect(toggleFrame).toHaveBeenCalledWith('path')
  })
})
