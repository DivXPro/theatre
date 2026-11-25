/**
 * @jest-environment jsdom
 */
import React, {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {PortalContext} from 'reakit'
import ContextMenu from './ContextMenu'

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  DOMRect: globalThis.DOMRect ?? {
    fromRect({x = 0, y = 0, width = 0, height = 0}: DOMRectInit = {}) {
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
      }
    },
  },
})

test('opens a keyboard-operable menu in the Studio portal at a supplied point', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const portal = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const actions: string[] = []

  function Fixture() {
    const [open, setOpen] = useState(false)
    return (
      <PortalContext.Provider value={portal}>
        <button onClick={() => setOpen(true)}>Open test menu</button>
        {open && (
          <ContextMenu
            displayName="Scene object"
            clickPoint={{clientX: 150, clientY: 120}}
            items={[
              {type: 'normal', label: 'Unavailable', enabled: false},
              {type: 'separator'},
              {
                type: 'normal',
                label: 'Move',
                callback: () => actions.push('move'),
              },
            ]}
            onRequestClose={() => setOpen(false)}
          />
        )}
      </PortalContext.Provider>
    )
  }

  try {
    await act(async () => root.render(<Fixture />))
    const trigger = host.querySelector('button')!
    await act(async () => trigger.click())

    const menu = portal.querySelector<HTMLElement>('[role="menu"]')
    expect(menu?.textContent).toContain('Scene object')
    expect(menu?.querySelector('[aria-disabled="true"]')?.textContent).toBe(
      'Unavailable',
    )
    expect(menu?.querySelector('[role="separator"]')).not.toBeNull()

    await act(async () => {
      menu!.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}),
      )
    })
    expect(document.activeElement?.textContent).toBe('Move')
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
      )
    })
    expect(actions).toEqual(['move'])
    expect(portal.querySelector('[role="menu"]')).toBeNull()

    await act(async () => trigger.click())
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
      )
    })
    expect(portal.querySelector('[role="menu"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    portal.remove()
  }
})
