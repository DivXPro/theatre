/*
 * @jest-environment jsdom
 */
import React from 'react'
import {act} from 'react'
import ReactDOM from 'react-dom/client'
import type {UIPanelId} from '@dreamerbird/core/types/private'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true

const studioBox = {atomP: {historic: {panelPositions: {}}}}
jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => studioBox,
}))

let BasePanel: typeof import('./BasePanel').default
let usePanel: typeof import('./BasePanel').usePanel
let StudioRootContext: typeof import('@dreamerbird/studio/UIRoot/StudioRootContext').StudioRootContext

beforeAll(async () => {
  ;({default: BasePanel, usePanel} = await import('./BasePanel'))
  ;({StudioRootContext} = await import(
    '@dreamerbird/studio/UIRoot/StudioRootContext'
  ))
})

function PanelProbe() {
  const {dims} = usePanel()
  return <span data-testid="dims">{JSON.stringify(dims)}</span>
}

async function renderPanel(rootElement?: HTMLElement) {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const root = ReactDOM.createRoot(mount)
  await act(async () => {
    root.render(
      <StudioRootContext.Provider value={rootElement ?? null}>
        <BasePanel
          panelId={'sequenceEditor' as UIPanelId}
          docked="bottom"
          minDims={{width: 200, height: 200}}
          defaultPosition={{
            edges: {
              left: {from: 'screenLeft', distance: 0},
              right: {from: 'screenRight', distance: 0},
              top: {from: 'screenBottom', distance: 0.4},
              bottom: {from: 'screenBottom', distance: 0},
            },
          }}
        >
          <PanelProbe />
        </BasePanel>
      </StudioRootContext.Provider>,
    )
  })
  return {mount, root}
}

test('docked panel dimensions follow the embedded Studio root', async () => {
  const editor = document.createElement('main')
  editor.getBoundingClientRect = () => ({
    width: 640,
    height: 480,
    x: 56,
    y: 0,
    top: 0,
    left: 56,
    right: 696,
    bottom: 480,
    toJSON: () => ({}),
  })
  const {mount, root} = await renderPanel(editor)

  expect(mount.querySelector('[data-testid="dims"]')?.textContent).toBe(
    JSON.stringify({width: 640, left: 0, top: 280, height: 200}),
  )

  await act(async () => root.unmount())
  mount.remove()
})
