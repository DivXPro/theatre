/*
 * @jest-environment jsdom
 */
/**
 * 顶栏分组与变换模式组(移动/旋转/缩放)的测试:
 * 四组连体容器带间隔排列;模式组互斥单选(当前模式带 selected 高亮),
 * 点击把对应 mode 传给 onSelectGizmoMode(与 G/R/S、右键菜单同源)。
 * 漫画模式用一个开关收起原始/线稿/网点三种状态:关闭即原始,开启后
 * 显示线稿/网点并从最近一次选择的漫画子模式恢复。
 * jsdom 直渲(无 testing-library),与 App.hostFlows.test.tsx 同一套手法。
 */
import React from 'react'
import {act} from 'react'
import ReactDOM from 'react-dom/client'
import type {GizmoMode} from './PlacementManager'
import type {ViewportRenderMode} from './mangaViewport'
// 模块加载即把 pg.* 词条注入 i18n 单例;tips 断言依赖英文词典
import './i18n'

// studio 的 ToolbarIconButton 依赖 react-merge-refs,jest 把它映射成了
// identity-obj-proxy(纯 ESM,transform 覆盖不到),这里补一个真实现。
// jest-esbuild 不提升 jest.mock,doMock 先行登记、再运行时 require。
jest.doMock('react-merge-refs', () => ({
  mergeRefs: (refs: Array<React.Ref<unknown> | undefined>) => (el: unknown) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(el)
      else (ref as React.MutableRefObject<unknown>).current = el
    }
  },
}))
const {TopToolbar} = require('./TopToolbar') as typeof import('./TopToolbar')

function renderToolbar(overrides: {
  gizmoMode?: GizmoMode
  onSelectGizmoMode?: (mode: GizmoMode) => void
  renderMode?: ViewportRenderMode
  onSelectRenderMode?: (mode: ViewportRenderMode) => void
}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  const render = (next: typeof overrides) => {
    const props = {
      onToggleModelLibrary: () => {},
      onTogglePathLibrary: () => {},
      onAddCamera: () => {},
      onAddAnchor: () => {},
      exportSinks: [],
      exporting: false,
      exportDisabled: false,
      onPickExportSink: () => {},
      onStopExport: () => {},
      pipVisible: false,
      onTogglePip: () => {},
      gizmoMode: next.gizmoMode ?? 'select',
      onSelectGizmoMode: next.onSelectGizmoMode ?? (() => {}),
      renderMode: next.renderMode ?? 'original',
      onSelectRenderMode: next.onSelectRenderMode ?? (() => {}),
    } as const
    act(() => {
      root.render(<TopToolbar {...props} />)
    })
  }
  render(overrides)
  return {
    el,
    rerender: (next: typeof overrides) => render(next),
    unmount: () => {
      act(() => root.unmount())
      el.remove()
    },
  }
}

/** 模式组 = 第一个连体容器;按 tooltip 文字找到对应按钮 */
function modeButton(el: HTMLElement, tip: string): HTMLButtonElement {
  const group = el.querySelector('div')!.children[0] as HTMLElement
  const btn = [...group.querySelectorAll('button')].find(
    (b) => b.textContent?.includes(tip),
  )
  if (!btn) throw new Error(`mode button "${tip}" not found`)
  return btn
}

describe('TopToolbar 分组', () => {
  it('按钮分四组渲染:变换模式 / 添加 / 渲染模式 / 输出', () => {
    const {el, unmount} = renderToolbar({})
    const groups = el.querySelector('div')!.children
    expect(groups.length).toBe(4)
    expect(groups[0].querySelectorAll('button').length).toBe(4)
    expect(groups[1].querySelectorAll('button').length).toBe(4)
    expect(groups[2].querySelectorAll('button').length).toBe(1)
    expect(groups[3].querySelectorAll('button').length).toBe(2)
    unmount()
  })
})

it('toggles manga mode and reveals the line/halftone choices', () => {
  const onSelectRenderMode = jest.fn()
  const {el, unmount} = renderToolbar({
    onSelectRenderMode,
  })
  const toggle = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Manga mode"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(el.querySelector('button[aria-label="Line art"]')).toBeNull()
  expect(el.querySelector('button[aria-label="Halftone"]')).toBeNull()
  act(() => toggle.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('line')
  unmount()
})

it('announces the active manga style and turns the whole mode off', () => {
  const onSelectRenderMode = jest.fn()
  const {el, unmount} = renderToolbar({
    renderMode: 'line',
    onSelectRenderMode,
  })
  const toggle = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Manga mode"]',
  )!
  const line = el.querySelector<HTMLButtonElement>(
    'button[aria-label="Line art"]',
  )!
  const halftone = el.querySelector<HTMLButtonElement>(
    'button[aria-label="Halftone"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(line.getAttribute('aria-pressed')).toBe('true')
  expect(halftone.getAttribute('aria-pressed')).toBe('false')
  act(() => halftone.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('halftone')
  act(() => toggle.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('original')
  unmount()
})

it('restores the last manga style after being switched off', () => {
  const onSelectRenderMode = jest.fn()
  const {el, rerender, unmount} = renderToolbar({
    renderMode: 'halftone',
    onSelectRenderMode,
  })
  rerender({renderMode: 'original', onSelectRenderMode})
  const toggle = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Manga mode"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  act(() => toggle.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('halftone')
  unmount()
})

describe('变换模式组', () => {
  it('当前模式的按钮带 selected 高亮,其余不带', () => {
    const {el, unmount} = renderToolbar({gizmoMode: 'rotate'})
    expect(modeButton(el, 'Select').classList.contains('selected')).toBe(false)
    expect(modeButton(el, 'Move').classList.contains('selected')).toBe(false)
    expect(modeButton(el, 'Rotate').classList.contains('selected')).toBe(true)
    expect(modeButton(el, 'Scale').classList.contains('selected')).toBe(false)
    unmount()
  })

  it('点击模式按钮传出对应 mode', () => {
    const onSelectGizmoMode = jest.fn()
    const {el, unmount} = renderToolbar({onSelectGizmoMode})
    for (const [tip, mode] of [
      ['Select', 'select'],
      ['Move', 'translate'],
      ['Rotate', 'rotate'],
      ['Scale', 'scale'],
    ] as const) {
      act(() => {
        modeButton(el, tip).dispatchEvent(
          new MouseEvent('click', {bubbles: true}),
        )
      })
      expect(onSelectGizmoMode).toHaveBeenLastCalledWith(mode)
    }
    expect(onSelectGizmoMode).toHaveBeenCalledTimes(4)
    unmount()
  })
})
