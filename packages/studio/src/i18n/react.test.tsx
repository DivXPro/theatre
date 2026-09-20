/**
 * @jest-environment jsdom
 */
/**
 * React 绑定端到端:provider 下的 useT() 组件,在 setLanguage 后必须
 * 真的换文案(用户报告的"切换后文字没变"的回归测试)。
 */
import React from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {
  I18nProvider,
  registerMessages,
  setLanguage,
  useT,
  usePropLabel,
  getLanguage,
} from '@dreamerbird/studio/i18n'
import {__resetI18nForTests} from './core'

function Probe() {
  const t = useT()
  return <span data-testid="probe">{t('probe.hello')}</span>
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  __resetI18nForTests()
  registerMessages('en', {'probe.hello': 'Hello'})
  registerMessages('zh-CN', {'probe.hello': '你好'})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

test('初始按当前语言渲染', () => {
  expect(container.textContent).toBe('Hello')
})

test('setLanguage 后界面文字跟着变(用户可见的切换)', () => {
  act(() => {
    setLanguage('zh-CN')
  })
  expect(container.textContent).toBe('你好')
  act(() => {
    setLanguage('en')
  })
  expect(container.textContent).toBe('Hello')
})

// 真实应用结构:studio UI(阴影 DOM)和宿主界面是两个独立的 React root,
// 语言切换发生在 studio root 的菜单里,宿主 root 的界面也必须即时变
test('两个 React root 共享单例:一边切换,两边都即时变', () => {
  const hostContainer = document.createElement('div')
  document.body.appendChild(hostContainer)
  const hostRoot = createRoot(hostContainer)
  act(() => {
    hostRoot.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
  })
  expect(hostContainer.textContent).toBe('Hello')

  // 从"studio 侧"切换(本测试的 root 模拟 studio,新 root 模拟宿主)
  act(() => {
    setLanguage('zh-CN')
  })
  expect(container.textContent).toBe('你好')
  expect(hostContainer.textContent).toBe('你好')

  act(() => {
    hostRoot.unmount()
    hostContainer.remove()
  })
})

// 属性名热切换的回归(用户两次报告):label 是函数形式时,语言切换后
// 已打开面板里的属性名必须立即更新,不能要求重新打开面板才变
test('usePropLabel:函数 label 随语言切换即时重取值,不重建组件', () => {
  const labelFn = jest.fn(() =>
    getLanguage() === 'zh-CN' ? '绑定路径' : 'Path Key',
  )
  function PropRowProbe() {
    return <span data-testid="prop">{usePropLabel(labelFn)}</span>
  }
  const propContainer = document.createElement('div')
  document.body.appendChild(propContainer)
  const propRoot = createRoot(propContainer)
  act(() => {
    propRoot.render(
      <I18nProvider>
        <PropRowProbe />
      </I18nProvider>,
    )
  })
  expect(propContainer.textContent).toBe('Path Key')
  const callsBeforeSwitch = labelFn.mock.calls.length

  // 面板开着不动,只切语言——属性名必须立刻变
  act(() => {
    setLanguage('zh-CN')
  })
  expect(propContainer.textContent).toBe('绑定路径')
  // 切换触发了重渲染 + 重新取值(订阅生效,不是死值)
  expect(labelFn.mock.calls.length).toBeGreaterThan(callsBeforeSwitch)

  act(() => {
    setLanguage('en')
    propRoot.unmount()
    propContainer.remove()
  })
})
