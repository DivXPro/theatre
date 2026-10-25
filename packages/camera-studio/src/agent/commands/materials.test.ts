import type {ISheetObject} from '@dreamerbird/core'
import type {Group} from 'three'
import type {PlacementEntry} from '../../PlacementManager'
import type {MaterialSlot, MaterialValues} from '../../materials/types'
import type {CommandContext} from '../types'

let projectSeq = 0
let activeFakeStudio: {transaction: unknown} | undefined

jest.doMock('@dreamerbird/core', () => ({
  ...jest.requireActual('@dreamerbird/core'),
  getStudioSync: () => activeFakeStudio,
}))

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => activeFakeStudio,
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

type SetupOptions = {roughnessTrack?: boolean}

function setup(options: SetupOptions = {}) {
  const {getPointerParts} =
    require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
  const core =
    require('@dreamerbird/core') as typeof import('@dreamerbird/core')
  const {globals} =
    require('@dreamerbird/core/globals') as typeof import('@dreamerbird/core/globals')
  const three = require('three') as typeof import('three')
  const {AgentCommandRegistry} =
    require('../registry') as typeof import('../registry')
  const {createAgentRuntime} =
    require('../runtime') as typeof import('../runtime')
  const objectRuntime =
    require('../runtime/objectRuntime') as typeof import('../runtime/objectRuntime')
  const {registerMaterialCommands} =
    require('./materials') as typeof import('./materials')
  const {registerKeyframeCommands} =
    require('./keyframes') as typeof import('./keyframes')
  const {registerObjectCommands} =
    require('./objects') as typeof import('./objects')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')
  const {collectMaterialSlots, createMaterialOverridesConfig} =
    require('../../materials/modelMaterials') as typeof import('../../materials/modelMaterials')

  const instance = new three.Group()
  const mesh = new three.Mesh(
    new three.BoxGeometry(),
    new three.MeshStandardMaterial({roughness: 0.8}),
  )
  mesh.name = 'Body'
  instance.add(mesh)
  const slots = collectMaterialSlots(instance)
  const slot = slots[0]!
  const slotKey = slot.slotKey

  const calls: Array<Record<string, unknown>> = []
  const sequenceEditor = {
    setPrimitivePropAsSequenced: jest.fn((args: Record<string, unknown>) => {
      calls.push({op: 'sequenceProp', args})
    }),
    setPrimitivePropAsStatic: jest.fn(),
    transformKeyframes: jest.fn(),
  }
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {
          set: (pointer: unknown, value: unknown) => void
          unset: (pointer: unknown) => void
          stateEditors: unknown
        }) => void,
        undoable?: boolean,
      ) =>
        fn({
          set: (pointer: unknown, value: unknown) => {
            const {path} = getPointerParts(pointer as never)
            calls.push({op: 'set', path: path.join('.'), value})
          },
          unset: (pointer: unknown) => {
            const {path} = getPointerParts(pointer as never)
            calls.push({op: 'unset', path: path.join('.')})
          },
          stateEditors: {
            coreByProject: {
              historic: {sheetsById: {sequence: sequenceEditor}},
            },
          },
        }),
    ),
  }
  activeFakeStudio = fakeStudio
  cleanups.push(() => {
    activeFakeStudio = undefined
  })

  const trackPath = JSON.stringify(['materialOverrides', slotKey, 'roughness'])
  const state = {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: options.roughnessTrack
            ? {
                Foo: {
                  trackIdByPropPath: {[trackPath]: 'roughness-track'},
                  trackData: {
                    'roughness-track': {
                      type: 'BasicKeyframedTrack',
                      keyframes: {
                        byId: {
                          kf1: {
                            id: 'kf1',
                            position: 0,
                            connectedRight: true,
                            handles: [0.5, 0.5, 0.5, 0.5],
                            value: 0.25,
                          },
                        },
                        allIds: {kf1: true},
                      },
                    },
                  },
                },
              }
            : {},
        },
      },
    },
  }
  const project = core.getProject(`agent-materials-${++projectSeq}`, {
    state: state as never,
  })
  const sheet = project.sheet('Scene')
  sheet.sequence.position = 0
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => fakeStudio as never,
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerMaterialCommands(registry, runtime)

  const placement: {entry: PlacementEntry; instance: Group} = {
    entry: {key: 'Foo', position: {x: 0, y: 0, z: 0}},
    instance,
  }
  cleanups.push(
    runtime.bindHandlers({
      getModelPlacement: ({key}) => (key === 'Foo' ? placement : undefined),
    }),
  )

  function mountFoo() {
    const t = core.types
    const registryObj = sheet.object(
      PLACEMENTS_REGISTRY_KEY,
      {list: t.string('[]')},
      {hideFromOutline: true},
    )
    registryObj.initialValue = {
      list: JSON.stringify([placement.entry]),
    }
    const obj = sheet.object('Foo', {
      materialOverrides: createMaterialOverridesConfig(slots),
    })
    objectRuntime.registerSceneSheetObject(
      'model:Foo',
      obj as ISheetObject<any>,
    )
    cleanups.push(() =>
      objectRuntime.unregisterSceneSheetObject(
        'model:Foo',
        obj as ISheetObject<any>,
      ),
    )
    return obj
  }

  return {
    core,
    registry,
    runtime,
    fakeStudio,
    calls,
    mountFoo,
    slot,
    slots,
    instance,
    registerKeyframeCommands: () => registerKeyframeCommands(registry, runtime),
    registerObjectCommands: () => registerObjectCommands(registry, runtime),
  }
}

test('materials.list returns evaluated values for the mounted model', async () => {
  const {registry, mountFoo, slot} = setup({roughnessTrack: true})
  mountFoo()

  const result = (await registry.execute(
    'materials.list',
    {objectId: 'model:Foo'},
    ctx(),
  )) as MaterialSlot[]

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({
    slotId: slot.slotId,
    slotKey: slot.slotKey,
    meshName: 'Body',
    values: {roughness: 0.25},
  })
})

test('materials.update writes one full compound patch in one undoable transaction', async () => {
  const {registry, fakeStudio, calls, mountFoo, slot} = setup()
  mountFoo()

  const result = await registry.execute(
    'materials.update',
    {
      objectId: 'model:Foo',
      slotId: slot.slotId,
      values: {roughness: 0.4, color: '#112233'},
    },
    ctx(),
  )

  expect(result).toEqual({revision: 1})
  expect(fakeStudio.transaction).toHaveBeenCalledTimes(1)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({op: 'set', path: 'materialOverrides'})
  const patch = calls[0]!.value as Record<string, MaterialValues>
  expect(patch[slot.slotKey]).toMatchObject({
    roughness: 0.4,
    color: '#112233',
    metalness: 0,
    opacity: 1,
    mapBlobId: '',
  })
})

test('materials.update validates ranges, colors, textures, slots and empty patches before writing', async () => {
  const {registry, fakeStudio, mountFoo, slot} = setup()
  mountFoo()
  const badValues: Array<Record<string, unknown>> = [
    {},
    {roughness: -0.1},
    {metalness: 1.1},
    {opacity: Number.NaN},
    {color: 'red'},
    {emissive: '#fff'},
    {mapBlobId: 4},
    {unknown: true},
  ]

  for (const values of badValues) {
    await expect(
      registry.execute(
        'materials.update',
        {objectId: 'model:Foo', slotId: slot.slotId, values},
        ctx(),
      ),
    ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  }
  await expect(
    registry.execute(
      'materials.update',
      {objectId: 'model:Foo', slotId: 'missing', values: {roughness: 0.2}},
      ctx(),
    ),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(fakeStudio.transaction).not.toHaveBeenCalled()
})

test('materials.update honors expectedRevision and rejects sequenced properties', async () => {
  const sequenced = setup({roughnessTrack: true})
  sequenced.mountFoo()
  await expect(
    sequenced.registry.execute(
      'materials.update',
      {
        objectId: 'model:Foo',
        slotId: sequenced.slot.slotId,
        values: {roughness: 0.6},
      },
      ctx(),
    ),
  ).rejects.toMatchObject({code: 'INVALID_STATE'})
  expect(sequenced.fakeStudio.transaction).not.toHaveBeenCalled()

  const conflict = setup()
  conflict.mountFoo()
  await expect(
    conflict.registry.execute(
      'materials.update',
      {
        objectId: 'model:Foo',
        slotId: conflict.slot.slotId,
        values: {roughness: 0.6},
        expectedRevision: 99,
      },
      ctx(),
    ),
  ).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
  expect(conflict.fakeStudio.transaction).not.toHaveBeenCalled()
})

test('roughness accepts keyframes at the materialOverrides compound leaf', async () => {
  const {registry, registerKeyframeCommands, calls, mountFoo, slot} = setup()
  mountFoo()
  registerKeyframeCommands()

  await registry.execute(
    'keyframes.set',
    {
      objectId: 'model:Foo',
      propPath: ['materialOverrides', slot.slotKey, 'roughness'],
      at: 0,
      value: 0.35,
    },
    ctx(),
  )

  expect(calls).toContainEqual({
    op: 'set',
    path: `materialOverrides.${slot.slotKey}.roughness`,
    value: 0.35,
  })
})

test('objects.update cannot write materialOverrides directly', async () => {
  const {registry, registerObjectCommands, fakeStudio, mountFoo, slot} = setup()
  mountFoo()
  registerObjectCommands()

  await expect(
    registry.execute(
      'objects.update',
      {
        objectId: 'model:Foo',
        props: {materialOverrides: {[slot.slotKey]: slot.values}},
      },
      ctx(),
    ),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  expect(fakeStudio.transaction).not.toHaveBeenCalled()
})
