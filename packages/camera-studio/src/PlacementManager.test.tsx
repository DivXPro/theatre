/** @jest-environment jsdom */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {IDBFactory} from 'fake-indexeddb'
import {Bone, BoxGeometry, Group, Mesh} from 'three'
import type {IProject, ISheet} from '@dreamerbird/core'
import {getLibrary} from './assetLibrary/library'
import type {ModelEntry} from './assetLibrary/types'

const loadAsync = jest.fn()
jest.doMock('./assetLibrary/gltfLoader', () => ({
  createGLTFLoader: () => ({loadAsync}),
}))

const {useNormalizedModel, usePlacementController} =
  require('./PlacementManager') as typeof import('./PlacementManager')

const model = {
  id: 'model-1',
  kind: 'model',
  name: 'Chair',
  blobId: 'blob-1',
} as ModelEntry
const project = {} as IProject
const sheet = {
  object: () => ({value: {list: '[]'}}),
} as unknown as ISheet
const position = {x: 2, y: 1, z: -3}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  indexedDB: new IDBFactory(),
})

test('已是米制的内置模型以 1 为放置缩放基线', async () => {
  const scene = new Group()
  scene.add(new Mesh(new BoxGeometry(60, 80, 100)))
  const root = createRoot(document.createElement('div'))

  function Probe() {
    const builtin = useNormalizedModel(scene, 'seed-model-large')
    const local = useNormalizedModel(scene)
    expect(builtin).toEqual({scale: 1, lift: 40})
    expect(local).toEqual({scale: 0.01, lift: 40})
    return null
  }

  try {
    await act(async () => root.render(<Probe />))
  } finally {
    await act(async () => root.unmount())
  }
})

test('已入库和旧 FBX 的 Mixamo 人体以 1 为放置缩放基线', async () => {
  const scene = new Group()
  scene.position.y = 5
  const mesh = new Mesh(new BoxGeometry(2, 4, 1))
  mesh.position.y = 1
  scene.add(mesh)
  for (const name of ['Hips', 'Head', 'LeftFoot', 'RightFoot']) {
    const bone = new Bone()
    bone.name = `mixamorig1${name}`
    scene.add(bone)
  }
  const root = createRoot(document.createElement('div'))

  function Probe() {
    const builtin = useNormalizedModel(scene, 'seed-model-remy')
    const imported = useNormalizedModel(scene, 'model-1')
    const legacy = useNormalizedModel(scene)
    expect(builtin).toEqual({scale: 1, modelScale: 0.45, lift: 1})
    expect(imported).toEqual(builtin)
    expect(legacy).toEqual(builtin)
    return null
  }

  try {
    await act(async () => root.render(<Probe />))
  } finally {
    await act(async () => root.unmount())
  }
})

describe('library model placement', () => {
  let controller: ReturnType<typeof usePlacementController>
  let root: ReturnType<typeof createRoot>
  let finishLoading: (result: {scene: Group; animations: []}) => void

  function Probe() {
    controller = usePlacementController(project, sheet)
    return null
  }

  beforeEach(async () => {
    jest.spyOn(getLibrary(), 'getEntry').mockResolvedValue(model)
    jest.spyOn(getLibrary(), 'getBlobUrl').mockResolvedValue('blob:chair')
    loadAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoading = resolve
        }),
    )
    root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    jest.restoreAllMocks()
  })

  test('records a release before decoding and transfers the decoded model to the placement', async () => {
    let loading!: Promise<void>
    await act(async () => {
      loading = controller.startPlacingFromLibrary(model)
      controller.confirmPlacing(position)
    })

    expect(controller.placing).toMatchObject({point: position})
    const scene = new Group()
    await act(async () => {
      finishLoading({scene, animations: []})
      await loading
    })

    expect(controller.placing).toBeNull()
    expect(controller.pendingEntries).toEqual([
      expect.objectContaining({
        libraryEntryId: model.id,
        position,
        loaded: {group: scene, animations: []},
      }),
    ])
  })

  test('cancels a confirmed placement while its model is still loading', async () => {
    let loading!: Promise<void>
    await act(async () => {
      loading = controller.startPlacingFromLibrary(model)
      controller.confirmPlacing(position)
      controller.cancelPlacing()
    })
    await act(async () => {
      finishLoading({scene: new Group(), animations: []})
      await loading
    })

    expect(controller.placing).toBeNull()
    expect(controller.pendingEntries).toEqual([])
  })
})
