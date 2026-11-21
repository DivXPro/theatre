/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import theatre, {getProject, onChange, val} from '@dreamerbird/core'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {globals} from '@dreamerbird/core/globals'
import {Atom} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {I18nProvider, setLanguage} from '@dreamerbird/studio/i18n'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import PointerEventsHandler from '@dreamerbird/studio/uiComponents/PointerEventsHandler'
import {IDBFactory} from 'fake-indexeddb'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {PortalContext} from 'reakit'
import {TextDecoder, TextEncoder} from 'util'
import '../i18n'
import {AnimationStripTrack} from './AnimationStripRow'
import {animationTracksProp, appendAnimationStrip} from './storage'

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  indexedDB: new IDBFactory(),
  TextDecoder,
  TextEncoder,
})
require('@dreamerbird/studio')
void theatre.init({studio: true, usePersistentStorage: false})

test('selects a strip, edits its duration, and shows a guide only while snapped', async () => {
  setLanguage('en')
  const project = getProject('animation-strip-editor', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      revisionHistory: [],
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 24,
            tracksByObject: {},
          },
        },
      },
    },
  })
  await project.ready
  const sheet = project.sheet('Scene')
  sheet.sequence.position = 3
  const actor = sheet.object('Actor', {animationTracks: animationTracksProp})
  const stop = onChange(actor.props.animationTracks, () => {})
  appendAnimationStrip(actor, 'walk', 1000, 1000)
  appendAnimationStrip(actor, 'wave', 1000, 4000)
  const layout = new Atom({
    scaledSpace: {
      leftPadding: 10,
      toUnitSpace: (pixels: number) => pixels / 100,
    },
  }).pointer as unknown as Pointer<SequenceEditorPanelLayout>
  const container = document.body.appendChild(document.createElement('div'))
  const portal = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const windowFocus = jest.spyOn(window, 'focus').mockImplementation(() => {})
  const mouse = (
    target: EventTarget,
    type: string,
    x: number,
    movement = 0,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      screenX: x,
    })
    Object.defineProperties(event, {
      movementX: {value: movement},
      movementY: {value: 0},
    })
    target.dispatchEvent(event)
  }
  try {
    await act(async () =>
      root.render(
        <PortalContext.Provider value={portal}>
          <I18nProvider>
            <PointerEventsHandler>
              <AnimationStripTrack
                object={actor}
                layout={layout}
                statuses={new Map([['walk', 'ready']])}
              />
            </PointerEventsHandler>
          </I18nProvider>
        </PortalContext.Provider>,
      ),
    )
    const walk = container.querySelector<HTMLElement>('[aria-label^="walk"]')!
    await act(async () => {
      mouse(walk, 'mousedown', 150)
      mouse(document, 'mouseup', 150)
    })
    expect(walk.getAttribute('aria-pressed')).toBe('true')
    const form = portal.querySelector('form')!
    expect(form).toBeTruthy()
    expect(document.activeElement).toBe(form.querySelector('[name="start"]'))
    const end = form.querySelector<HTMLInputElement>('[name="end"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(end, '1.75')
      end.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      getCoreTicker().tick()
    })
    expect(
      JSON.parse(val(actor.props.animationTracks)).tracks[0].strips[0],
    ).toMatchObject({
      startMs: 1000,
      sourceOutMs: 750,
    })
    expect(walk.getAttribute('aria-pressed')).toBe('true')

    await act(async () => mouse(walk, 'mousedown', 150))
    await act(async () => mouse(document, 'mousemove', 347, 30))
    expect(container.querySelector('[data-snap-guide]')).toBeTruthy()
    await act(async () => {
      mouse(document, 'mouseup', 347)
      getCoreTicker().tick()
    })
    expect(container.querySelector('[data-snap-guide]')).toBeNull()
    expect(
      JSON.parse(val(actor.props.animationTracks)).tracks[0].strips[0],
    ).toMatchObject({
      startMs: 3000,
      sourceOutMs: 750,
    })
  } finally {
    await act(async () => root.unmount())
    container.remove()
    portal.remove()
    stop()
    windowFocus.mockRestore()
  }
})
