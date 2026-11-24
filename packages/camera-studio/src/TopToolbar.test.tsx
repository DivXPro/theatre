/*
 * @jest-environment jsdom
 */
/**
 * 顶栏分组与变换模式组(移动/旋转/缩放)的测试:
 * 四组连体容器带间隔排列;模式组互斥单选(当前模式带 selected 高亮),
 * 点击把对应 mode 传给 onSelectGizmoMode(与 G/R/S、右键菜单同源)。
 * 漫画模式用一个开关收起原始/线稿两种状态:关闭即原始,开启后显示
 * 线稿与投射阴影开关。
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
  mangaShadows?: boolean
  onToggleMangaShadows?: () => void
  characterNamesVisible?: boolean
  onToggleCharacterNames?: () => void
  headerActions?: React.ReactNode
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
      mangaShadows: next.mangaShadows ?? false,
      onToggleMangaShadows: next.onToggleMangaShadows ?? (() => {}),
      characterNamesVisible: next.characterNamesVisible ?? false,
      onToggleCharacterNames: next.onToggleCharacterNames ?? (() => {}),
      headerActions: next.headerActions,
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

/** Locate the transform control by its accessible name. */
function modeButton(el: HTMLElement, tip: string): HTMLButtonElement {
  const btn = [...el.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === tip,
  )
  if (!btn) throw new Error(`mode button "${tip}" not found`)
  return btn
}

describe('TopToolbar 分组', () => {
  it('puts transforms, creation, rendering, and export in one toolbar', () => {
    const {el, unmount} = renderToolbar({})
    const actions = el.querySelector(
      '[role="toolbar"][aria-label="Viewport actions"]',
    )!
    expect(actions).not.toBeNull()
    expect(actions.querySelectorAll('button')).toHaveLength(12)
    expect(actions.contains(modeButton(el, 'Rotate'))).toBe(true)
    unmount()
  })

  it('places host navigation alongside export in the output group', () => {
    const {el, unmount} = renderToolbar({
      headerActions: <a href="/projects">Projects</a>,
    })
    const toolbar = el.querySelector('[role="toolbar"]')!
    const editing = toolbar.querySelector(
      '[role="group"][aria-label="Editing"]',
    )!
    const output = toolbar.querySelector('[role="group"][aria-label="Output"]')!
    expect(editing?.nextElementSibling).toBe(output)
    expect(editing?.contains(modeButton(el, 'Rotate'))).toBe(true)
    expect(output?.contains(modeButton(el, 'Export video'))).toBe(true)
    expect(output?.querySelector('a[href="/projects"]')).toBeInstanceOf(
      HTMLElement,
    )
    unmount()
  })
})

it('toggles character names independently of manga mode', () => {
  const onToggleCharacterNames = jest.fn()
  const {el, rerender, unmount} = renderToolbar({onToggleCharacterNames})
  try {
    const toggle = () =>
      el.querySelector<HTMLButtonElement>(
        'button[role="switch"][aria-label="Character names"]',
      )!
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    act(() => toggle().click())
    expect(onToggleCharacterNames).toHaveBeenCalledTimes(1)

    rerender({
      renderMode: 'line',
      characterNamesVisible: true,
      onToggleCharacterNames,
    })
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    act(() => toggle().click())
    expect(onToggleCharacterNames).toHaveBeenCalledTimes(2)
  } finally {
    unmount()
  }
})

it('toggles manga mode and reveals line art and cast shadows', () => {
  const onSelectRenderMode = jest.fn()
  const {el, unmount} = renderToolbar({
    onSelectRenderMode,
  })
  const toggle = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Manga mode"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(el.querySelector('button[aria-label="Line art"]')).toBeNull()
  expect(el.querySelector('button[aria-label="Cast shadow"]')).toBeNull()
  act(() => toggle.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('line')
  unmount()
})

it('toggles cast shadows inside manga mode and can turn the mode off', () => {
  const onSelectRenderMode = jest.fn()
  const onToggleMangaShadows = jest.fn()
  const {el, rerender, unmount} = renderToolbar({
    renderMode: 'line',
    mangaShadows: false,
    onSelectRenderMode,
    onToggleMangaShadows,
  })
  const toggle = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Manga mode"]',
  )!
  const line = el.querySelector<HTMLButtonElement>(
    'button[aria-label="Line art"]',
  )!
  const shadow = el.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Cast shadow"]',
  )!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(line.getAttribute('aria-pressed')).toBe('true')
  expect(shadow.getAttribute('aria-checked')).toBe('false')
  act(() => shadow.click())
  expect(onToggleMangaShadows).toHaveBeenCalledTimes(1)

  rerender({
    renderMode: 'line',
    mangaShadows: true,
    onSelectRenderMode,
    onToggleMangaShadows,
  })
  expect(
    el
      .querySelector<HTMLButtonElement>(
        'button[role="switch"][aria-label="Cast shadow"]',
      )!
      .getAttribute('aria-checked'),
  ).toBe('true')

  act(() => toggle.click())
  expect(onSelectRenderMode).toHaveBeenLastCalledWith('original')
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
