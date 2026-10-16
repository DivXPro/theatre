/* eslint-disable no-restricted-syntax */
/**
 * LeftStrip 显隐槽回归:studio.ui.setLeftStripHidden 写 ephemeralAtom
 * .leftStripHidden;LeftStrip 读槽为 true 时整条不渲染(宿主可用
 * camera-studio 的 ui.hideLeftStrip 初始化参数触发)。
 */
import {Atom} from '@dreamerbird/dataverse'

const studioBox: {ephemeralAtom: Atom<{leftStripHidden?: boolean}>} = {
  ephemeralAtom: new Atom({}),
}

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => studioBox,
  setStudio: () => {},
}))
jest.doMock('./AppButton/AppButton', () => ({
  __esModule: true,
  default: () => null,
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
