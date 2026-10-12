/*
 * @jest-environment jsdom
 */
/**
 * UI 装配可配(T9,spec §3 ui 字段 / §7 约束):
 *  - getUiConfig 缺省/合并语义(单测);
 *  - portalContainer 可配:真实 PosePropEditor 点开姿势选择框,
 *    断言框渲染进宿主给的容器且 z-index 以配置为基准;
 *  - 缺省复位:portal 回 document.body、z-index 基准回 1000。
 *
 * PosePropEditor 走真实链路(库单例 + fake-indexeddb + 内置目录),
 * 不整树渲染场景。React 19 act 环境开关手写(testing-library 缺席,R13
 * 先例);真实模块链下 react/react-dom 静态 import 安全(无
 * resetModules)。
 */
import {IDBFactory} from 'fake-indexeddb'
import React from 'react'
import {act} from 'react-dom/test-utils'
import ReactDOM from 'react-dom/client'
import {getUiConfig, setUiConfig} from './uiConfig'
import PosePropEditor from './poseMode/PosePropEditor'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as any).indexedDB = new IDBFactory()
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

afterEach(() => {
  setUiConfig({}) // 模块级单值,用例间必须复位
})

describe('getUiConfig 缺省与合并', () => {
  it('缺省 = 现状:portal 无指定容器、zIndexBase 1000', () => {
    expect(getUiConfig()).toEqual({zIndexBase: 1000})
  })

  it('setUiConfig 整体替换:portalContainer/zIndexBase/locale 合并进读侧', () => {
    const host = document.createElement('div')
    setUiConfig({portalContainer: host, zIndexBase: 5000, locale: 'zh-CN'})
    expect(getUiConfig()).toEqual({
      portalContainer: host,
      zIndexBase: 5000,
      locale: 'zh-CN',
    })
  })
})

/** 渲染真实 PosePropEditor 并点值区域,返回宿主容器与卸载器 */
async function renderPicker(
  ui: {portalContainer?: HTMLElement; zIndexBase?: number},
  mount: HTMLElement,
): Promise<{host: HTMLElement | undefined; unmount: () => Promise<void>}> {
  setUiConfig(ui)
  const root = ReactDOM.createRoot(mount)
  // 替身只喂断言用到的字段;propConfig 等其余必填项经 unknown 转成
  // 组件 props 型让行(never 不能展开)
  const editorProps = {
    editingTools: {permanentlySetValue: jest.fn()},
    value: '',
    obj: undefined,
  } as unknown as React.ComponentProps<typeof PosePropEditor>
  await act(async () => {
    root.render(<PosePropEditor {...editorProps} />)
  })
  // 库条目异步装载(listEntries)再渲染;补两拍冲刷微任务
  await act(async () => {})
  await act(async () => {})
  const value = mount.querySelector('[data-testid="PosePropValue"]')
  expect(value).not.toBeNull()
  await act(async () => {
    value!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
  return {
    host: ui.portalContainer,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      mount.remove()
    },
  }
}

describe('portalContainer 可配(真实姿势属性编辑器)', () => {
  it('portalContainer 可配:选择框渲染进宿主给的容器,z-index 以 5000 为基准', async () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const {unmount} = await renderPicker(
      {portalContainer: host, zIndexBase: 5000},
      mount,
    )
    const frame = host.querySelector('[data-testid="PosePickerFrame"]')
    expect(frame).not.toBeNull() // 渲染进了宿主容器,而非 document.body 直挂
    expect(
      document.body.querySelectorAll('[data-testid="PosePickerFrame"]'),
    ).toHaveLength(1)
    expect((frame as HTMLElement).style.zIndex).toBe('5000')
    await unmount()
    host.remove()
  })

  it('缺省:portal 落 document.body,z-index 基准 1000', async () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const {unmount} = await renderPicker({}, mount)
    const frame = document.body.querySelector('[data-testid="PosePickerFrame"]')
    expect(frame).not.toBeNull()
    expect((frame as HTMLElement).style.zIndex).toBe('1000')
    await unmount()
  })
})
