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
import type {PlacingState} from './PlacementManager'
import {
  getHostFlowsHandle,
  getPlacingSnapshot,
  setHostFlowsHandle,
  setPlacingSnapshot,
  subscribePlacing,
  usePlacing,
} from './hostFlows'

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
