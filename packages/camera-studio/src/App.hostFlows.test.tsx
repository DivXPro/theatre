/*
 * @jest-environment jsdom
 */
/**
 * App 宿主接线:三 props 的透传与默认行为。App 内含 R3F Canvas,
 * jsdom 下渲染成本高——本文件只测纯接线逻辑(HostFlowsWiring 子组件
 * 抽出,见实现),不整树渲染 App。
 */
import React from 'react'
import type {ReactElement} from 'react'
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import {getHostFlowsHandle, getPlacingSnapshot} from './hostFlows'
import type {CameraFlows} from './hostFlows'

// App.tsx 顶层 import 场景 glb,jest 无法解析二进制模块;three/examples/jsm
// 是纯 ESM,node_modules 不在 jest transform 范围。jest-esbuild 不提升
// jest.mock,故用 doMock 先行登记、再运行时 require App(与 hostFlows 共享
// 同一模块实例,句柄注册表可观测)。
jest.doMock('./scene.glb', () => 'scene.glb')
jest.doMock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: class RoomEnvironment {},
}))
// 内置资产 2026-10-10 目录化后不再经 vite 目录 glob 播种:条目来自入库
// 清单 + StaticCatalogSource,jest 下静态 import 链无 vite 专属语法
const {HostFlowsWiring} = require('./App') as {
  HostFlowsWiring: (props: {
    flows: CameraFlows
    onFlows?: (f: CameraFlows) => void
  }) => ReactElement
}

describe('HostFlowsWiring', () => {
  it('mount 时交付句柄并挂注册表,unmount 清空注册表', () => {
    const flows = {fake: true} as never
    const onFlows = jest.fn()
    const el = document.createElement('div')
    const root = ReactDOM.createRoot(el)
    act(() => {
      root.render(<HostFlowsWiring flows={flows} onFlows={onFlows} />)
    })
    expect(onFlows).toHaveBeenCalledWith(flows)
    expect(getHostFlowsHandle()).toBe(flows)
    act(() => {
      root.unmount()
    })
    expect(getHostFlowsHandle()).toBeNull()
    el.remove()
  })
})

describe('默认行为等价(回归)', () => {
  it('placing 快照接线未运行时为 null', () => {
    expect(getPlacingSnapshot()).toBeNull()
  })
})
