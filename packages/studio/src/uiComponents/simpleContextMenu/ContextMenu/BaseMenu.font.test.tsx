/**
 * @jest-environment jsdom
 */
// 调试:右键菜单字体到底渲染成什么。jsdom 的 CSS 支持有限(var() 不解),
// 这里主要看 styled-components 生成的规则文本 + 元素挂点。
import React from 'react'
import {createRoot} from 'react-dom/client'
// @ts-ignore
import {act} from 'react-dom/test-utils'
import BaseMenu from '@dreamerbird/studio/uiComponents/simpleContextMenu/ContextMenu/BaseMenu'

function render(el: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(el)
  })
  return container
}

test('BaseMenu 字体/颜色带同值兜底(主文档 portal 路径下令牌不存在)', () => {
  const host = render(
    <BaseMenu
      items={[{label: '查看此镜头', callback: () => {}}]}
      onRequestClose={() => {}}
    />,
  )
  const menu = host.querySelector('ul')!
  expect(menu).toBeTruthy()
  // styled-components 注入的样式文本
  const styles = [...document.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .join('\n')
  // 字体/字号/颜色必须带 fallback:菜单被外层应用在自己的树里渲染时
  // portal 落在主文档,studio 的 --theatre-* 令牌不存在,没兜底会
  // 回落成文档默认 16px 字 + 黑色字
  expect(styles).toContain('--theatre-font-family')
  expect(styles).toMatch(/--theatre-font-size\s*,\s*11px/)
  expect(styles).toMatch(/--theatre-text-primary\s*,\s*#ffffff/)
})
