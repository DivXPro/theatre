/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import theatre, {
  getProject,
  getStudioSync,
  onChange,
  types as t,
  val,
} from '@dreamerbird/core'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {globals} from '@dreamerbird/core/globals'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {Atom, prism} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import {usePrism} from '@dreamerbird/react'
import getStudio from '@dreamerbird/studio/getStudio'
import {I18nProvider, setLanguage, translate} from '@dreamerbird/studio/i18n'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {calculateSequenceEditorTree} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/tree'
import {
  getAdditionalSequenceRows,
  registerAdditionalSequenceRow,
  registerAdditionalSequenceRows,
  registerSequenceEditorView,
} from '@dreamerbird/studio/panels/SequenceEditorPanel/additionalRows'
import type {AdditionalSequenceRow} from '@dreamerbird/studio/panels/SequenceEditorPanel/additionalRows'
import PointerEventsHandler from '@dreamerbird/studio/uiComponents/PointerEventsHandler'
import {ProvideLogger} from '@dreamerbird/studio/uiComponents/useLogger'
import {createTheatreInternalLogger} from '@dreamerbird/utils/logger'
import {IDBFactory} from 'fake-indexeddb'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {PortalContext} from 'reakit'
import {TextDecoder, TextEncoder} from 'util'
import '../i18n'
import {configureLibrary, getLibrary} from '../assetLibrary/library'
import {StaticCatalogSource} from '../assetLibrary/staticCatalogSource'
import {
  AnimationStripHeader,
  AnimationStripObjectActions,
  AnimationStripTrack,
  AnimationStripToolbar,
} from './AnimationStripRow'
import {renderAnimationStripSidebar} from './AnimationStripSidebar'
import {parseAnimationTracks} from './model'
import {
  addAnimationTrack,
  animationTracksProp,
  appendAnimationStrip,
  insertAnimationStrip,
} from './storage'
import type {AnimationTracksObject} from './storage'
import {
  animationObjectAddressKey,
  clearAnimationStripSelection,
  registerAnimationStripActionOpener,
  selectAnimationStrip,
} from './stripSelection'

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  indexedDB: new IDBFactory(),
  TextDecoder,
  TextEncoder,
})

test('lays out ordered management and track rows reactively and cleans up the current registration only', async () => {
  const project = getProject('animation-strip-row-layout')
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Actor', {animationTracks: animationTracksProp})
  const row = (id: string): AdditionalSequenceRow => ({
    id,
    renderHeader: () => null,
    renderTrack: () => null,
  })
  const toolbar = {...row('toolbar'), countsAsTrack: false}
  const rows = new Atom<readonly AdditionalSequenceRow[]>([
    toolbar,
    row('first'),
  ])
  const unregisterLegacy = registerAdditionalSequenceRow(object, () =>
    row('legacy'),
  )
  const resolved = prism(() => getAdditionalSequenceRows(object))
  const tree = prism(() =>
    calculateSequenceEditorTree(privateAPI(sheet), getStudio()),
  )
  expect(resolved.getValue().map(({id}) => id)).toEqual(['legacy'])
  const unregister = registerAdditionalSequenceRows(object, () =>
    val(rows.pointer),
  )
  try {
    unregisterLegacy()
    expect(resolved.getValue()).toEqual([
      toolbar,
      expect.objectContaining({id: 'first'}),
    ])
    rows.set([toolbar, row('second'), row('first')])
    expect(resolved.getValue().map(({id}) => id)).toEqual([
      'toolbar',
      'second',
      'first',
    ])
    const [objectRow] = tree.getValue().children
    const firstRowTop = objectRow.top + objectRow.nodeHeight
    expect(
      objectRow.additionalRows.map(({content, top, n}) => [content.id, top, n]),
    ).toEqual([
      ['toolbar', firstRowTop, objectRow.n + 1],
      ['second', firstRowTop + 28, objectRow.n + 2],
      ['first', firstRowTop + 56, objectRow.n + 3],
    ])
    expect(objectRow.heightIncludingChildren).toBe(objectRow.nodeHeight + 84)
  } finally {
    unregister()
  }
  expect(resolved.getValue()).toEqual([])
  expect(tree.getValue().children).toEqual([])
})

test('hides an empty object until it is selected, then exposes its row actions', async () => {
  const project = getProject('object-row-action')
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Actor', {animationTracks: animationTracksProp})
  const unregister = registerAdditionalSequenceRows(object, () => [
    {
      id: 'object-actions',
      isHeaderVisible: () => false,
      renderObjectHeader: () => <span>Object actions</span>,
      renderHeader: () => null,
      renderTrack: () => null,
    },
  ])
  try {
    const readTree = () =>
      prism(() =>
        calculateSequenceEditorTree(privateAPI(sheet), getStudio()),
      ).getValue()

    expect(readTree().children).toEqual([])

    getStudio().transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...object.address, type: 'SheetObject'},
      ])
    })

    const [objectRow] = readTree().children
    expect(objectRow.additionalRows).toEqual([
      expect.objectContaining({
        shouldRender: false,
        nodeHeight: 0,
      }),
    ])
    expect(objectRow.heightIncludingChildren).toBe(objectRow.nodeHeight)
  } finally {
    unregister()
  }
})

test('shows objects with a property track and hides them when the track is removed', async () => {
  const project = getProject('object-row-property-track')
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Actor', {value: t.number(0)})
  const stop = onChange(object.props.value, () => {})
  const readTree = () =>
    prism(() =>
      calculateSequenceEditorTree(privateAPI(sheet), getStudio()),
    ).getValue()
  try {
    expect(readTree().children).toEqual([])

    getStudioSync()!.transaction(({sequenceProp}) =>
      sequenceProp(object.props.value),
    )
    const rows = readTree().children
    expect(rows).toHaveLength(1)
    expect(rows[0].sheetObject.address.objectKey).toBe('Actor')

    getStudioSync()!.transaction(({unsequenceProp}) =>
      unsequenceProp(object.props.value),
    )
    expect(readTree().children).toEqual([])
  } finally {
    stop()
  }
})

test('keeps a selected object hidden when it has neither tracks nor row actions', async () => {
  const project = getProject('object-row-selected-empty')
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Camera', {value: t.number(0)})
  getStudio().transaction(({stateEditors}) => {
    stateEditors.studio.historic.panels.outline.selection.set([
      {...object.address, type: 'SheetObject'},
    ])
  })
  const tree = prism(() =>
    calculateSequenceEditorTree(privateAPI(sheet), getStudio()),
  ).getValue()
  expect(tree.children).toEqual([])
})

test('does not leak selection across projects with the same sheet and object names', async () => {
  const first = getProject('object-row-selection-source')
  const second = getProject('object-row-selection-target')
  await Promise.all([first.ready, second.ready])
  const source = first.sheet('Scene').object('Actor', {
    animationTracks: animationTracksProp,
  })
  const target = second.sheet('Scene').object('Actor', {
    animationTracks: animationTracksProp,
  })
  const register = (object: typeof source) =>
    registerAdditionalSequenceRows(object, () => [
      {
        id: 'object-actions',
        isHeaderVisible: () => false,
        renderObjectHeader: () => <span>Object actions</span>,
        renderHeader: () => null,
        renderTrack: () => null,
      },
    ])
  const unregisterSource = register(source)
  const unregisterTarget = register(target)
  try {
    getStudio().transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...source.address, type: 'SheetObject'},
      ])
    })
    const targetTree = prism(() =>
      calculateSequenceEditorTree(
        privateAPI(second.sheet('Scene')),
        getStudio(),
      ),
    ).getValue()
    expect(targetTree.children).toEqual([])
  } finally {
    unregisterSource()
    unregisterTarget()
  }
})

test('shows an object when a registered additional row has timeline content', async () => {
  const project = getProject('object-row-additional-track')
  await project.ready
  const sheet = project.sheet('Scene')
  const object = sheet.object('Actor', {animationTracks: animationTracksProp})
  const row = (id: string): AdditionalSequenceRow => ({
    id,
    renderHeader: () => null,
    renderTrack: () => null,
  })
  const unregister = registerAdditionalSequenceRows(object, () => [
    {...row('toolbar'), countsAsTrack: false, isHeaderVisible: () => false},
    row('track'),
  ])
  try {
    const tree = prism(() =>
      calculateSequenceEditorTree(privateAPI(sheet), getStudio()),
    ).getValue()
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].sheetObject.address.objectKey).toBe('Actor')
  } finally {
    unregister()
  }
})

test('adds both track kinds and inserts a repeated object clip with only the chosen channel', async () => {
  setLanguage('en')
  const project = getProject('animation-strip-object-editor')
  await project.ready
  const actor = project
    .sheet('Scene')
    .object('Actor', {animationTracks: animationTracksProp})
  const stop = onChange(actor.props.animationTracks, () => {})
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const read = () => {
    const state = parseAnimationTracks(val(actor.props.animationTracks))
    if (state.kind !== 'tracks') throw new Error('Expected saved tracks')
    return state.document.tracks
  }
  try {
    await act(async () =>
      root.render(
        <I18nProvider>
          <AnimationStripObjectActions object={actor} canAddBone={false} />
        </I18nProvider>,
      ),
    )
    expect(container.querySelectorAll('button')).toHaveLength(1)
    await act(async () => {
      container.querySelector('button')!.click()
      getCoreTicker().tick()
    })
    const objectMenu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(objectMenu).toBeTruthy()
    expect(objectMenu.textContent).toContain(
      translate('pg.strips.addObjectTrack'),
    )
    expect(objectMenu.textContent).not.toContain(
      translate('pg.strips.addBoneTrack'),
    )
    await act(async () => {
      Array.from(
        objectMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      )
        .find(
          (item) =>
            item.textContent?.includes(translate('pg.strips.addObjectTrack')),
        )!
        .click()
      getCoreTicker().tick()
    })
    const [track] = read()
    expect(track.kind).toBe('object')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await act(async () =>
      root.render(
        <I18nProvider>
          <AnimationStripObjectActions object={actor} canAddBone />
        </I18nProvider>,
      ),
    )
    const addTrack = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    )!
    expect(addTrack).toBeTruthy()
    await act(async () => {
      addTrack.click()
      getCoreTicker().tick()
    })
    const boneMenu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(boneMenu.textContent).toContain(translate('pg.strips.addBoneTrack'))
    await act(async () => {
      Array.from(
        boneMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      )
        .find(
          (item) =>
            item.textContent?.includes(translate('pg.strips.addBoneTrack')),
        )!
        .click()
      getCoreTicker().tick()
    })
    expect(read().map(({kind}) => kind)).toEqual(['object', 'bone'])
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await act(async () =>
      root.render(
        <I18nProvider>
          <AnimationStripToolbar
            object={actor}
            legacyControl={<span>Legacy picker</span>}
            status="Track status"
          />
        </I18nProvider>,
      ),
    )
    expect(container.textContent).toContain('Legacy picker')
    expect(container.textContent).toContain('Track status')
    await act(async () =>
      root.render(
        <I18nProvider>
          <AnimationStripHeader
            object={actor}
            trackId={track.id}
            trackKind="object"
            rig={null}
          />
        </I18nProvider>,
      ),
    )
    await act(async () => container.querySelector('button')!.click())
    const form = container.querySelector('dialog form')!
    const position = form.querySelector<HTMLInputElement>(
      'input[value="position"]',
    )!
    await act(async () => position.click())
    const repeat = form.querySelector<HTMLInputElement>('[name="repeat"]')!
    await setNumber(repeat, '3')
    await act(async () => {
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      getCoreTicker().tick()
    })
    expect(container.querySelector('dialog')).toBeNull()
    expect(read()[0].strips).toEqual([
      expect.objectContaining({
        startMs: 0,
        sourceInMs: 0,
        repeat: 3,
        objectChannels: ['position'],
      }),
    ])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    stop()
  }
})

test('edits repeats and moves a clip from the requested track, then opens the action editor', async () => {
  setLanguage('en')
  const project = getProject('animation-strip-multi-track')
  await project.ready
  const actor = project
    .sheet('Scene')
    .object('Actor', {animationTracks: animationTracksProp})
  const stop = onChange(actor.props.animationTracks, () => {})
  const firstTrackId = addAnimationTrack(actor, 'bone')!
  const secondTrackId = addAnimationTrack(actor, 'bone')!
  const objectTrackId = addAnimationTrack(actor, 'object')!
  insertAnimationStrip(actor, secondTrackId, 'walk', 1000, {
    startMs: 1000,
    sourceInMs: 0,
    sourceOutMs: 500,
  })
  const layout = new Atom({
    scaledSpace: {
      leftPadding: 10,
      toUnitSpace: (pixels: number) => pixels / 100,
    },
  }).pointer as unknown as Pointer<SequenceEditorPanelLayout>
  const container = document.body.appendChild(document.createElement('div'))
  const portal = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const onEditAction = jest.fn()
  const unregisterOpener = registerAnimationStripActionOpener(
    animationObjectAddressKey(actor.address),
    onEditAction,
  )
  const read = () => {
    const state = parseAnimationTracks(val(actor.props.animationTracks))
    if (state.kind !== 'tracks') throw new Error('Expected saved tracks')
    return state.document.tracks
  }
  try {
    await act(async () =>
      root.render(
        <PortalContext.Provider value={portal}>
          <I18nProvider>
            <PointerEventsHandler>
              {[firstTrackId, secondTrackId].map((trackId) => (
                <AnimationStripTrack
                  key={trackId}
                  object={actor}
                  layout={layout}
                  statuses={new Map()}
                  trackId={trackId}
                  trackKind="bone"
                  onEditAction={onEditAction}
                />
              ))}
              <StripPropertiesHarness object={actor} />
            </PointerEventsHandler>
          </I18nProvider>
        </PortalContext.Provider>,
      ),
    )
    const walk = container.querySelector<HTMLElement>('[aria-label^="walk"]')!
    expect(walk).toBeTruthy()
    await act(async () =>
      walk.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
      ),
    )
    const form = container.querySelector<HTMLFormElement>(
      'form[data-camera-strip-properties]',
    )!
    expect(form).toBeTruthy()
    expect(container.querySelector('dialog')).toBeNull()
    expect(
      Array.from(
        form.querySelectorAll('legend'),
        (legend) => legend.textContent,
      ),
    ).toEqual(['Clip', 'Action'])
    const [clipFields, actionFields] = form.querySelectorAll('fieldset')
    expect(
      Array.from(clipFields.querySelectorAll('input'), ({name}) => name),
    ).toEqual(['start', 'end', 'repeat'])
    expect(
      Array.from(actionFields.querySelectorAll('input'), ({name}) => name),
    ).toEqual(['sourceIn', 'sourceOut'])
    await setNumber(
      form.querySelector<HTMLInputElement>('[name="repeat"]')!,
      '3',
    )
    expect(form.querySelector<HTMLInputElement>('[name="end"]')!.value).toBe(
      '2.5',
    )
    await act(async () => {
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      getCoreTicker().tick()
    })
    expect(read()[1].strips[0].repeat).toBe(3)
    const destination =
      container.querySelector<HTMLSelectElement>('[name="track"]')!
    expect(Array.from(destination.options, ({value}) => value)).toEqual([
      firstTrackId,
      secondTrackId,
    ])
    expect(
      destination.querySelector(`option[value="${objectTrackId}"]`),
    ).toBeNull()
    await act(async () => {
      destination.value = firstTrackId
      destination.dispatchEvent(new Event('change', {bubbles: true}))
      getCoreTicker().tick()
    })
    expect(read()[1].strips).toEqual([])
    const [moved] = read()[0].strips
    expect(moved.repeat).toBe(3)
    const movedNode = container.querySelector<HTMLElement>(
      '[aria-label^="walk"]',
    )!
    expect(movedNode.getAttribute('aria-pressed')).toBe('true')
    await act(async () =>
      movedNode.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})),
    )
    expect(onEditAction).toHaveBeenCalledWith(moved)
    await act(async () =>
      movedNode.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
      ),
    )
    const edit = Array.from(
      container.querySelectorAll<HTMLButtonElement>('form button'),
    ).find((button) => button.textContent === translate('pg.strips.editAction'))
    expect(edit).toBeDefined()
    await act(async () => edit!.click())
    expect(onEditAction).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    portal.remove()
    unregisterOpener()
    clearAnimationStripSelection()
    stop()
  }
})

async function setNumber(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
require('@dreamerbird/studio')
void theatre.init({studio: true, usePersistentStorage: false})

function StripPropertiesHarness({object}: {object: AnimationTracksObject}) {
  return usePrism(
    () =>
      renderAnimationStripSidebar(
        object,
        parseAnimationTracks(val(object.props.animationTracks)),
      ),
    [object],
  )
}

test('opens clip properties inside the timeline and collapses the sidebar on close', async () => {
  jest.doMock('identity-obj-proxy', () => 'asset.svg')
  jest.doMock(
    '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/DopeSheet',
    () => ({__esModule: true, default: () => null}),
  )
  jest.doMock(
    '@dreamerbird/studio/panels/SequenceEditorPanel/RightOverlay/RightOverlay',
    () => ({__esModule: true, default: () => null}),
  )
  const {default: SequenceEditorPanel} = await import(
    '@dreamerbird/studio/panels/SequenceEditorPanel/SequenceEditorPanel'
  )
  const project = getProject('animation-strip-docked-sidebar')
  await project.ready
  const actor = project
    .sheet('Scene')
    .object('Actor', {animationTracks: animationTracksProp})
  appendAnimationStrip(actor, 'seed-animation-a2fe5381c78cfd7c', 1000, 1000)
  const state = parseAnimationTracks(val(actor.props.animationTracks))
  if (state.kind !== 'tracks') throw new Error('Expected saved tracks')
  const strip = state.document.tracks[0].strips[0]
  const unregisterRows = registerAdditionalSequenceRows(actor, () => [
    {
      id: 'walk',
      renderHeader: () => null,
      renderTrack: () => null,
      renderSidebar: () => renderAnimationStripSidebar(actor, state),
    },
  ])
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const logger = createTheatreInternalLogger().getLogger()
  const previousLibrary = getLibrary()
  configureLibrary({
    sources: [
      new StaticCatalogSource({baseUrl: 'https://example.test/assets/'}),
    ],
  })
  try {
    await act(async () => {
      getStudioSync()!.setSelection([actor])
      selectAnimationStrip(actor.address, strip.id)
      root.render(
        <PortalContext.Provider value={container}>
          <I18nProvider>
            <ProvideLogger logger={logger}>
              <PointerEventsHandler>
                <SequenceEditorPanel />
              </PointerEventsHandler>
            </ProvideLogger>
          </I18nProvider>
        </PortalContext.Provider>,
      )
    })
    const timeline = container.querySelector('[data-panel-id="sequenceEditor"]')
    expect(timeline).toBeTruthy()
    const sidebar = timeline!.querySelector('[data-sequence-editor-sidebar]')
    expect(
      sidebar?.querySelector('form[data-camera-strip-properties]'),
    ).toBeTruthy()
    expect(sidebar?.querySelector('strong')?.textContent).toBe(
      'Mixamo Locomotion - Walking',
    )
    let closeView: (() => void) | undefined
    try {
      await act(async () => {
        closeView = registerSequenceEditorView(actor.sheet.sequence, {
          timeline: <div>Local action timeline</div>,
          sidebar: <div>Action inspector</div>,
        })
        getStudioSync()!.setSelection([actor.sheet])
      })
      expect(closeView).toBeDefined()
      expect(
        timeline!.querySelector('[data-sequence-editor-tracks]')?.textContent,
      ).toBe('Local action timeline')
      expect(
        timeline!.querySelector('[data-sequence-editor-sidebar]')?.textContent,
      ).toBe('Action inspector')
    } finally {
      await act(async () => {
        closeView?.()
        getStudioSync()!.setSelection([actor])
      })
    }
    expect(
      timeline!.querySelector('form[data-camera-strip-properties]'),
    ).toBeTruthy()
    await act(async () => {
      timeline!.querySelector<HTMLButtonElement>('.close')!.click()
    })
    expect(timeline!.querySelector('[data-sequence-editor-sidebar]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    unregisterRows()
    clearAnimationStripSelection()
    configureLibrary({
      sources: previousLibrary.sources,
      writable: previousLibrary.writable,
    })
  }
})

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
  const trackId = JSON.parse(val(actor.props.animationTracks)).tracks[0].id
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
                trackId={trackId}
              />
              <StripPropertiesHarness object={actor} />
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
    const form = container.querySelector<HTMLFormElement>(
      'form[data-camera-strip-properties]',
    )!
    expect(form).toBeTruthy()
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

    await act(async () => {
      container
        .querySelector<HTMLFormElement>('form[data-camera-strip-properties]')!
        .querySelector<HTMLButtonElement>('.close')!
        .click()
      getCoreTicker().tick()
    })
    expect(
      container.querySelector('form[data-camera-strip-properties]'),
    ).toBeNull()

    await act(async () => mouse(walk, 'mousedown', 150))
    await act(async () => mouse(document, 'mousemove', 347, 30))
    expect(container.querySelector('[data-snap-guide]')).toBeTruthy()
    expect(
      container.querySelector('form[data-camera-strip-properties]'),
    ).toBeNull()
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
    clearAnimationStripSelection()
  }
})
