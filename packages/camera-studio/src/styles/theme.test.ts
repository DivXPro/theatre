/** @jest-environment jsdom */
import {observeCameraColorMode} from './theme'

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
