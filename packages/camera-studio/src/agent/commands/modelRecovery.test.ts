import type {CommandContext} from '../types'

let activeFakeStudio: {transaction: unknown} | undefined

jest.doMock('@dreamerbird/studio/getStudio', () => ({
  __esModule: true,
  default: () => activeFakeStudio,
}))

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

test('retry and replacement remount an unmounted model in one undoable transaction', async () => {
  const core =
    require('@dreamerbird/core') as typeof import('@dreamerbird/core')
  const {globals} =
    require('@dreamerbird/core/globals') as typeof import('@dreamerbird/core/globals')
  const {AgentCommandRegistry} =
    require('../registry') as typeof import('../registry')
  const {createAgentRuntime} =
    require('../runtime') as typeof import('../runtime')
  const {registerModelCommands} =
    require('./models') as typeof import('./models')
  const {PLACEMENTS_REGISTRY_KEY} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')

  const project = core.getProject('agent-model-recovery', {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    } as never,
  })
  const sheet = project.sheet('Scene')
  const registryObject = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: core.types.string('[]')},
    {hideFromOutline: true},
  )
  registryObject.initialValue = {
    list: JSON.stringify([
      {
        key: 'Broken',
        libraryEntryId: 'old-model',
        position: {x: 1, y: 2, z: 3},
      },
    ]),
  }
  const calls: Array<Record<string, unknown>> = []
  let notifyHistoric = () => {}
  const fakeStudio = {
    transaction: jest.fn(
      (
        fn: (tools: {set: (pointer: unknown, value: unknown) => void}) => void,
      ) => {
        fn({
          set: (pointer, value) => {
            const {getPointerParts} =
              require('@dreamerbird/dataverse') as typeof import('@dreamerbird/dataverse')
            calls.push({
              path: getPointerParts(pointer as never).path.join('.'),
              value,
            })
          },
        })
        queueMicrotask(() => notifyHistoric())
      },
    ),
  }
  activeFakeStudio = fakeStudio
  const replacement = {
    id: 'new-model',
    kind: 'model',
    name: 'Replacement',
    rig: 'static',
    blobId: 'new-blob',
    contentHash: 'new-hash',
    boneCount: 0,
    vertexCount: 8,
    createdAt: 2,
  }
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {
      getEntry: async (id: string) =>
        id === replacement.id ? replacement : undefined,
    } as never,
    getStudio: () => fakeStudio as never,
    subscribeHistoric: (listener) => {
      notifyHistoric = listener
      return () => {}
    },
  })
  const registry = new AgentCommandRegistry()
  registerModelCommands(registry, runtime)

  try {
    await expect(
      registry.execute('models.retry', {objectId: 'model:Broken'}, ctx()),
    ).resolves.toEqual({revision: expect.any(Number)})
    await expect(
      registry.execute(
        'models.replace',
        {
          objectId: 'model:Broken',
          assetId: replacement.id,
        },
        ctx(),
      ),
    ).resolves.toEqual({revision: expect.any(Number)})

    expect(fakeStudio.transaction).toHaveBeenCalledTimes(2)
    const retryEntry = JSON.parse(String(calls[0]!.value))[0]
    expect(retryEntry).toMatchObject({
      key: 'Broken',
      libraryEntryId: 'old-model',
      loadAttempt: 1,
      position: {x: 1, y: 2, z: 3},
    })
    const replacementEntry = JSON.parse(String(calls[1]!.value))[0]
    expect(replacementEntry).toMatchObject({
      key: 'Broken',
      libraryEntryId: replacement.id,
      loadAttempt: 1,
      position: {x: 1, y: 2, z: 3},
    })
    expect(replacementEntry.assetId).toBeUndefined()
  } finally {
    activeFakeStudio = undefined
    runtime.dispose()
  }
})

test('failed model placeholder remains an identifiable scene object', () => {
  const {Group, Mesh} = require('three') as typeof import('three')
  const {createFailedModelPlaceholder} =
    require('../../PlacementManager') as typeof import('../../PlacementManager')
  const placeholder = createFailedModelPlaceholder('Broken')
  expect(placeholder).toBeInstanceOf(Group)
  expect(placeholder.name).toBe('Failed/Broken')
  expect(placeholder.children.some((child) => child instanceof Mesh)).toBe(true)
})
