/** @jest-environment jsdom */
import {setLanguage} from '@dreamerbird/studio/i18n'
import {findChodrialByDomNode} from '@dreamerbird/studio/uiComponents/chordial/chordialInternals'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
jest.doMock('@dreamerbird/studio/assets/logo.png', () => 'logo.png')

test('the app menu uses the host language without offering language choices', async () => {
  const {default: AppButton} = await import('./AppButton')
  const container = document.createElement('div')
  const popover = document.createElement('div')
  const root = createRoot(container)
  const popoverRoot = createRoot(popover)

  try {
    setLanguage('en', {explicit: true})
    act(() => root.render(<AppButton />))

    const chordial = findChodrialByDomNode(container.firstElementChild)
    const invoke = chordial?.atom.get().optsFn().invoke
    if (!invoke || typeof invoke === 'function') {
      throw new Error('The app menu did not register a popover')
    }

    const openMenu = () =>
      act(() => popoverRoot.render(invoke.render({close: () => {}})))
    openMenu()
    expect(popover.textContent).toContain('Help')
    expect(popover.textContent).not.toContain('English')

    setLanguage('zh-CN', {explicit: true})
    openMenu()
    expect(popover.textContent).toContain('帮助')
    expect(popover.textContent).not.toContain('英语')
  } finally {
    act(() => {
      popoverRoot.unmount()
      root.unmount()
    })
    setLanguage('en', {explicit: true})
  }
})
