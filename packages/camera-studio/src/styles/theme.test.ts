/** @jest-environment jsdom */
import {observeCameraColorMode} from './theme'

it('uses the nearest host theme and follows changes above a nested portal', async () => {
  const root = document.documentElement
  const wrapper = document.createElement('main')
  const portal = document.createElement('div')
  document.body.append(wrapper)
  wrapper.append(portal)
  root.dataset.theme = 'light'
  const dispose = observeCameraColorMode(portal)
  try {
    expect(root.dataset.cameraStudioColorMode).toBe('light')
    wrapper.dataset.theme = 'dark'
    await Promise.resolve()
    expect(root.dataset.cameraStudioColorMode).toBe('dark')
    portal.dataset.theme = 'light'
    await Promise.resolve()
    expect(root.dataset.cameraStudioColorMode).toBe('light')
    delete portal.dataset.theme
    await Promise.resolve()
    expect(root.dataset.cameraStudioColorMode).toBe('dark')
    delete wrapper.dataset.theme
    await Promise.resolve()
    expect(root.dataset.cameraStudioColorMode).toBe('light')
  } finally {
    dispose()
    delete root.dataset.theme
    wrapper.remove()
  }
})

it('follows the host theme until the scene is disposed', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  host.dataset.theme = 'light'
  const dispose = observeCameraColorMode(host)
  const mode = () => document.documentElement.dataset.cameraStudioColorMode

  try {
    expect(mode()).toBe('light')

    host.dataset.theme = 'dark'
    await Promise.resolve()
    expect(mode()).toBe('dark')

    host.dataset.theme = 'light'
    await Promise.resolve()
    expect(mode()).toBe('light')

    delete host.dataset.theme
    await Promise.resolve()
    expect(mode()).toBe('dark')

    host.dataset.theme = 'sepia'
    await Promise.resolve()
    expect(mode()).toBe('dark')

    dispose()
    host.dataset.theme = 'light'
    await Promise.resolve()
    expect(mode()).toBeUndefined()
  } finally {
    dispose()
    host.remove()
  }
})
