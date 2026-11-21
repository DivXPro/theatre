/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import 'fake-indexeddb/auto'
import {TextDecoder, TextEncoder} from 'node:util'
import type {ProjectId} from '@dreamerbird/core'
import type {CoreBits} from '@dreamerbird/core/CoreBundle'
import type Project from '@dreamerbird/core/projects/Project'
import {Atom} from '@dreamerbird/dataverse'
import {deriveSaazNames} from '@dreamerbird/studio/StudioStore/saazNames'

Object.assign(globalThis, {TextDecoder, TextEncoder})

async function createStudio() {
  const {Studio} = await import('@dreamerbird/studio/Studio')
  const studio = new Studio()
  studio.setCoreBits({
    privateAPI: () => undefined,
    getCoreRafDriver: () => undefined,
    coreExports: {},
    projectsP: new Atom({projects: {}}).pointer.projects,
  } as unknown as CoreBits)
  return studio
}

test('a host-owned Studio initializes without opening either project database', async () => {
  const persistenceKey = 'host-owned'
  const {frontDbName, backDbName} = deriveSaazNames(persistenceKey)
  const open = jest.spyOn(indexedDB, 'open')
  const studio = await createStudio()

  try {
    await studio.initialize({persistenceKey, usePersistentStorage: false})
    await studio.initialized
    const openedNames = open.mock.calls.map(([name]) => name)
    expect(openedNames).not.toContain(frontDbName)
    expect(openedNames).not.toContain(backDbName)
  } finally {
    open.mockRestore()
  }
})

test('project storage observes committed state and ignores discarded previews', async () => {
  const studio = await createStudio()
  await studio.initialize({usePersistentStorage: false})
  await studio.initialized

  const projectId = 'host-scene' as ProjectId
  const state = {
    sheetsById: {},
    definitionVersion: '0.4.0',
    revisionHistory: ['initial'],
  }
  studio.transaction(({stateEditors}) => {
    stateEditors.coreByProject.historic.setProjectState({projectId, state})
  })
  const save = jest.fn()
  const unsubscribe = studio._store.subscribeToProjectState(projectId, save)
  try {
    expect(studio._store.hasTemporaryChanges()).toBe(false)
    const preview = studio.tempTransaction(({stateEditors}) => {
      stateEditors.coreByProject.historic.revisionHistory.add({
        projectId,
        revision: 'preview',
      })
    })
    expect(studio._store.hasTemporaryChanges()).toBe(true)
    preview.discard()
    expect(studio._store.hasTemporaryChanges()).toBe(false)
    expect(save).not.toHaveBeenCalled()

    studio.transaction(({stateEditors}) => {
      stateEditors.coreByProject.historic.revisionHistory.add({
        projectId,
        revision: 'saved',
      })
    })
    expect(save).toHaveBeenCalledWith({
      ...state,
      revisionHistory: ['saved', 'initial'],
    })
  } finally {
    unsubscribe()
  }
})

test('host project assets use the injected URL and upload functions', async () => {
  const studio = await createStudio()
  await studio.initialize({usePersistentStorage: false})
  const hostStorage = {
    getAssetUrl: (id: string) => `/uploads/${id}`,
    createAsset: jest.fn(async (_file: File) => 'model.fbx'),
  }
  const project = {
    address: {projectId: 'host-scene'},
    config: {assets: {storage: hostStorage}},
  } as unknown as Project
  const open = jest.spyOn(indexedDB, 'open')
  try {
    const storage = await studio.createAssetStorage(project)
    const file = new File([], 'model.fbx')
    await expect(storage.createAsset(file)).resolves.toBe('model.fbx')
    expect(hostStorage.createAsset).toHaveBeenCalledWith(file)
    expect(storage.getAssetUrl('model.fbx')).toBe('/uploads/model.fbx')
    expect(open).not.toHaveBeenCalled()
  } finally {
    open.mockRestore()
  }
})
