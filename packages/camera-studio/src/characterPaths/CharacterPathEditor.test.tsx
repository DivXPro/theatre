/** @jest-environment jsdom */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import '../i18n'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

jest.mock('@dreamerbird/react', () => ({
  usePrism: (read: () => unknown) => read(),
  useVal: (value: unknown) => value,
}))

jest.mock('@dreamerbird/studio/uiComponents/Popover/usePopover', () => ({
  __esModule: true,
  default: () => ({
    isOpen: false,
    toggle: () => {},
    close: () => {},
    node: null,
  }),
}))

jest.mock('../CameraPath', () => ({
  pathObjectName: (key: string) => key,
}))

jest.mock('./index', () => ({
  CHARACTER_PATH_EDITOR: 'characterPathBinding',
  evaluateCharacterPath: () => ({
    status: 'active',
    pathId: 'Pos Path: id',
    pathKey: 'Pos Path',
    progress: 50,
    distance: 2.5,
    totalLength: 5,
  }),
  readCharacterPathChoices: () => [],
  setCharacterPathBinding: jest.fn(),
}))

test('shows the repair controls and keeps a rejected binding open', async () => {
  const {CharacterPathBindingForm} =
    require('./CharacterPathEditor') as typeof import('./CharacterPathEditor')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const commit = jest.fn(() => ({
    ok: false as const,
    message: 'Walk strip uses root motion',
  }))
  try {
    await act(async () => {
      root.render(
        <CharacterPathBindingForm
          choices={[{pathKey: 'Replacement Path'}]}
          evaluation={{status: 'missing', pathId: 'Deleted Path: id'}}
          orient
          commit={commit}
          close={() => {
            throw new Error('A rejected binding must leave the form open')
          }}
        />,
      )
    })
    expect(host.textContent).toContain('The bound path is missing')
    const select = host.querySelector('select')!
    await act(async () => {
      select.value = 'Replacement Path'
      select.dispatchEvent(new Event('change', {bubbles: true}))
    })
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.some((button) => button.textContent === 'Unbind')).toBe(true)
    const confirm = buttons.find(
      (button) => button.textContent === 'Confirm binding',
    )!
    await act(async () => confirm.click())
    expect(commit).toHaveBeenCalledWith({
      pathKey: 'Replacement Path',
      orient: true,
    })
    expect(host.querySelector('[role=alert]')?.textContent).toBe(
      'Walk strip uses root motion',
    )
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('shows only the path binding control in the detail panel', async () => {
  const {CharacterPathEditor} =
    require('./CharacterPathEditor') as typeof import('./CharacterPathEditor')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const character = {
    address: {objectKey: 'Character'},
    props: {characterPathOrient: true},
    sheet: {},
    value: {characterPathId: 'Pos Path: id', characterPathProgress: 50},
  }
  try {
    await act(async () => {
      root.render(
        <CharacterPathEditor
          {...({
            editingTools: {type: 'Sequenced'},
            obj: {address: {objectKey: 'Character'}, publicApi: character},
            propConfig: {},
            value: 50,
          } as any)}
        />,
      )
    })
    expect(host.querySelector('input')).toBeNull()
    expect(host.textContent).toContain('Bound · Heading')
    expect(host.textContent).not.toContain('2.50')
    expect(host.textContent).not.toContain('5.00')
    expect(
      host.querySelector('[aria-label="Character path settings"]'),
    ).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
