/*
 * @jest-environment jsdom
 */
import {
  mountStudioRoot,
  mountStudioRootWhenReady,
  resetStudioRootCache,
} from './studioRoot'

function createStudioRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'theatrejs-studio-root'
  root.style.position = 'fixed'
  root.style.inset = '0'
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  resetStudioRootCache()
  document.body.innerHTML = ''
})

test('mountStudioRoot scopes fixed Studio panels to the host editor', () => {
  const root = createStudioRoot()
  const editor = document.createElement('main')
  document.body.appendChild(editor)

  expect(mountStudioRoot(editor)).toBe(root)
  expect(root.parentElement).toBe(editor)
  expect(root.style.position).toBe('absolute')
  expect(root.style.inset).toBe('0')
  expect(root.style.transform).toBe('translateZ(0)')
  expect(root.style.zIndex).toBe('40')
})

test('mountStudioRoot restores the default viewport mounting', () => {
  const root = createStudioRoot()
  const editor = document.createElement('main')
  document.body.appendChild(editor)
  mountStudioRoot(editor)

  mountStudioRoot()

  expect(root.parentElement).toBe(document.body)
  expect(root.style.position).toBe('fixed')
  expect(root.style.transform).toBe('')
  expect(root.style.zIndex).toBe('100')
})

test('mountStudioRoot is a no-op before Studio creates its root', () => {
  expect(mountStudioRoot(document.createElement('main'))).toBeUndefined()
})

test('mountStudioRootWhenReady waits for the asynchronously appended root', async () => {
  const editor = document.createElement('main')
  document.body.appendChild(editor)
  const mounted = mountStudioRootWhenReady(editor)
  setTimeout(createStudioRoot, 10)

  const root = await mounted

  expect(root?.parentElement).toBe(editor)
  expect(root?.style.position).toBe('absolute')
})

test('mountStudioRoot remounts a root retained from an unmounted editor', () => {
  const root = createStudioRoot()
  const firstEditor = document.createElement('main')
  document.body.appendChild(firstEditor)
  mountStudioRoot(firstEditor)
  firstEditor.remove()
  const secondEditor = document.createElement('main')
  document.body.appendChild(secondEditor)

  expect(mountStudioRoot(secondEditor)).toBe(root)
  expect(root.parentElement).toBe(secondEditor)
  expect(root.isConnected).toBe(true)
})
