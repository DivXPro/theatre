/* eslint-disable no-restricted-syntax */
/**
 * LeftStrip 显隐槽回归:studio.ui.setLeftStripHidden 写 ephemeralAtom
 * .leftStripHidden;LeftStrip 读槽为 true 时整条不渲染(宿主可用
 * camera-studio 的 ui.hideLeftStrip 初始化参数触发)。
 */
import {Atom} from '@dreamerbird/dataverse'
import type {StudioLogo} from '@dreamerbird/core'

const studioBox: {
  ephemeralAtom: Atom<{
    leftStripHidden?: boolean
    toolbarLogo?: StudioLogo
  }>
} = {
  ephemeralAtom: new Atom({}),
}

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => studioBox,
  setStudio: () => {},
}))
jest.doMock('./AppButton/AppButton', () => ({
  __esModule: true,
  default: () => 'default-logo',
}))
jest.doMock('./WorkspaceButton/WorkspaceButton', () => ({
  __esModule: true,
  default: () => null,
}))

test('LeftStrip:默认渲染整条;leftStripHidden=true 时整条不渲染', async () => {
  const React = await import('react')
  const {renderToStaticMarkup} = await import('react-dom/server')
  const LeftStrip = (await import('./LeftStrip')).default

  studioBox.ephemeralAtom = new Atom({})
  expect(renderToStaticMarkup(React.createElement(LeftStrip))).not.toBe('')

  studioBox.ephemeralAtom = new Atom<{leftStripHidden?: boolean}>({
    leftStripHidden: true,
  })
  expect(renderToStaticMarkup(React.createElement(LeftStrip))).toBe('')
})

test('a host can replace and restore the default toolbar logo', async () => {
  const React = await import('react')
  const {renderToStaticMarkup} = await import('react-dom/server')
  const LeftStrip = (await import('./LeftStrip')).default
  studioBox.ephemeralAtom = new Atom({})
  const UI = (await import('../../../UI/UI')).default
  const ui = {studio: studioBox} as unknown as InstanceType<typeof UI>

  UI.prototype.setLogo.call(
    ui,
    React.createElement('a', {href: '/projects'}, 'Host logo'),
  )
  const custom = renderToStaticMarkup(React.createElement(LeftStrip))
  expect(custom).toContain('Host logo')
  expect(custom).not.toContain('default-logo')

  UI.prototype.setLogo.call(ui)
  expect(renderToStaticMarkup(React.createElement(LeftStrip))).toContain(
    'default-logo',
  )
})
