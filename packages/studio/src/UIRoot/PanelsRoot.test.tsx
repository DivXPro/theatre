/*
 * @jest-environment jsdom
 */
import React from 'react'
import {act} from 'react'
import ReactDOM from 'react-dom/client'
import {Atom} from '@dreamerbird/dataverse'
import type {StudioPanelVisibility} from '@dreamerbird/core/types/public'

const fakeObject = {
  address: {
    projectId: 'project',
    sheetId: 'Scene',
    sheetInstanceId: 'default',
    objectKey: 'cube',
  },
  sheet: {address: {sheetId: 'Scene', sheetInstanceId: 'default'}},
}
const studioBox = {
  ephemeralAtom: new Atom<{
    hiddenPanels?: {outline?: boolean; details?: boolean}
  }>({}),
  atomP: {
    ahistoric: {pinOutline: undefined, pinDetails: undefined},
    historic: {
      projects: {
        stateByProjectId: {
          project: {outlineNamesByObjectAddress: {}},
        },
      },
    },
  },
  paneManager: {allPanesD: {}},
}

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => studioBox,
}))
jest.doMock('@dreamerbird/core', () => ({
  __esModule: true,
  __private: {
    instanceTypes: {isSheetObject: (value: unknown) => value === fakeObject},
  },
}))
jest.doMock('@dreamerbird/studio/selectors', () => ({
  __esModule: true,
  outlineSelection: {getValue: () => [fakeObject]},
}))
jest.doMock('@dreamerbird/studio/uiComponents/useHotspot', () => ({
  __esModule: true,
  default: () => false,
}))
jest.doMock('@dreamerbird/studio/uiComponents/usePresence', () => ({
  __esModule: true,
  usePresenceListenersOnRootElement: () => {},
}))
jest.doMock(
  '@dreamerbird/studio/panels/OutlinePanel/ProjectsList/ProjectsList',
  () => ({__esModule: true, default: () => 'outline-content'}),
)
jest.doMock('@dreamerbird/studio/panels/DetailPanel/ObjectDetails', () => ({
  __esModule: true,
  default: () => null,
}))
jest.doMock(
  '@dreamerbird/studio/panels/SequenceEditorPanel/SequenceEditorPanel',
  () => ({__esModule: true, default: () => 'timeline-content'}),
)
jest.doMock('@dreamerbird/studio/UI/UINonSSRBits', () => ({
  __esModule: true,
  default: class {},
}))

let PanelsRoot: typeof import('./PanelsRoot').default
let UI: typeof import('@dreamerbird/studio/UI/UI').default

beforeAll(async () => {
  PanelsRoot = (await import('./PanelsRoot')).default
  UI = (await import('@dreamerbird/studio/UI/UI')).default
})

beforeEach(() => {
  studioBox.ephemeralAtom = new Atom({})
  ;(
    globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  ).IS_REACT_ACT_ENVIRONMENT = true
})

function setPanelVisibility(visibility: StudioPanelVisibility): void {
  UI.prototype.setPanelVisibility.call(
    {studio: studioBox} as unknown as InstanceType<typeof UI>,
    visibility,
  )
}

function renderPanels() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  return {
    container,
    async mount() {
      await act(async () => {
        root.render(<PanelsRoot />)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function expectTimelineAndOutline(container: HTMLElement): void {
  expect(container.textContent).toContain('timeline-content')
  expect(container.textContent).toContain('outline-content')
}

test('DetailPanel reacts to hiddenPanels changes without hiding OutlinePanel or timeline', async () => {
  const panels = renderPanels()
  await panels.mount()
  expect(
    panels.container.querySelector('[data-testid="DetailPanel-Object"]'),
  ).not.toBeNull()

  await act(async () => {
    setPanelVisibility({details: false})
  })

  expect(
    panels.container.querySelector('[data-testid="DetailPanel-Object"]'),
  ).toBeNull()
  expectTimelineAndOutline(panels.container)
  await panels.unmount()
})

test('partial panel visibility updates retain the unmentioned panel across remount', async () => {
  setPanelVisibility({details: false})
  let panels = renderPanels()
  await panels.mount()
  expect(
    panels.container.querySelector('[data-testid="DetailPanel-Object"]'),
  ).toBeNull()

  await act(async () => {
    setPanelVisibility({outline: false})
  })
  await panels.unmount()

  panels = renderPanels()
  await panels.mount()
  expect(
    panels.container.querySelector('[data-testid="DetailPanel-Object"]'),
  ).toBeNull()
  expect(panels.container.textContent).toContain('timeline-content')
  expect(panels.container.textContent).not.toContain('outline-content')
  await panels.unmount()
})
