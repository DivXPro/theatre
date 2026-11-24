import {BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture} from 'three'
import {SkeletonUtils} from 'three-stdlib'
import {
  applyMaterialScalars,
  cloneModelMaterials,
  collectMaterialSlots,
  createMaterialOverridesConfig,
  createMaterialTextureController,
} from './modelMaterials'
import type {MaterialValues} from './types'
import {disposeObjectTree} from '../assetLibrary/dispose'

function modelWithTwoMeshes() {
  const root = new Group()
  const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  a.name = 'Body'
  b.name = 'Body'
  root.add(a, b)
  return {root, a, b}
}

function values(overrides: Partial<MaterialValues> = {}): MaterialValues {
  return {
    color: '#ffffff',
    metalness: 0,
    roughness: 1,
    emissive: '#000000',
    opacity: 1,
    mapBlobId: '',
    normalMapBlobId: '',
    roughnessMapBlobId: '',
    metalnessMapBlobId: '',
    emissiveMapBlobId: '',
    ...overrides,
  }
}

test('stable slot keys survive traversal and duplicate mesh names', () => {
  const {root} = modelWithTwoMeshes()
  const slots = collectMaterialSlots(root)
  expect(slots).toHaveLength(2)
  expect(slots[0]!.slotId).not.toBe(slots[1]!.slotId)
  expect(slots[0]!.slotKey).not.toBe(slots[1]!.slotKey)
  expect(collectMaterialSlots(root)).toEqual(slots)
})

test('SkeletonUtils.clone instances receive isolated materials and scalar updates stay instance-local', () => {
  const {root} = modelWithTwoMeshes()
  const first = SkeletonUtils.clone(root) as Group
  const second = SkeletonUtils.clone(root) as Group
  cloneModelMaterials(first)
  cloneModelMaterials(second)

  const firstSlots = collectMaterialSlots(first)
  const secondSlots = collectMaterialSlots(second)
  const firstMesh = first.children[0] as Mesh
  const secondMesh = second.children[0] as Mesh
  const firstMaterial = firstMesh.material as MeshStandardMaterial
  const secondMaterial = secondMesh.material as MeshStandardMaterial

  expect(firstMaterial).not.toBe(secondMaterial)
  expect(firstMaterial).not.toBe((root.children[0] as Mesh).material)
  applyMaterialScalars(first, firstSlots, {
    [firstSlots[0]!.slotKey]: values({roughness: 0.2, color: '#112233'}),
  })

  expect(firstMaterial.roughness).toBe(0.2)
  expect(firstMaterial.color.getHexString()).toBe('112233')
  expect(secondMaterial.roughness).toBe(1)
  expect(secondMaterial.color.getHexString()).toBe('ffffff')
})

test('white manga materials preserve source assets and explicit material settings', () => {
  const {root, a, b} = modelWithTwoMeshes()
  b.material.userData.mangaShading = true
  const instance = SkeletonUtils.clone(root)
  cloneModelMaterials(instance, {whiteManga: true})

  const clonedMeshes = instance.children as Array<typeof a>
  expect(clonedMeshes[0].material.userData.mangaShading).toBe(false)
  expect(a.material.userData.mangaShading).toBeUndefined()
  expect(clonedMeshes[1].material.userData.mangaShading).toBe(true)
})

test('Theatre material configs are cached and hidden from the property panel', () => {
  const {root} = modelWithTwoMeshes()
  const slots = collectMaterialSlots(root)
  const first = createMaterialOverridesConfig(slots)
  const second = createMaterialOverridesConfig(slots)
  expect(second).toBe(first)
  expect(first.hidden).toBe(true)
})

test('texture updates dispose replacements, and empty IDs restore immutable originals', async () => {
  const {root, a} = modelWithTwoMeshes()
  const original = new Texture()
  const sourceMaterial = a.material as MeshStandardMaterial
  sourceMaterial.map = original
  cloneModelMaterials(root)
  const material = a.material as MeshStandardMaterial
  const slots = collectMaterialSlots(root)
  const first = new Texture()
  const second = new Texture()
  const firstDispose = jest.spyOn(first, 'dispose')
  const secondDispose = jest.spyOn(second, 'dispose')
  const textures = new Map([
    ['blob:first', first],
    ['blob:second', second],
  ])
  const invalidate = jest.fn()
  const controller = createMaterialTextureController({
    getBlobUrl: async (blobId) => `url:${blobId}`,
    loadTexture: async (url) => textures.get(url.slice(4))!,
    invalidate,
  })

  const initialVersion = material.version
  await controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'blob:first'},
  })
  expect(material.map).toBe(first)
  expect(material.version).toBeGreaterThan(initialVersion)

  await controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'blob:second'},
  })
  expect(material.map).toBe(second)
  expect(firstDispose).toHaveBeenCalledTimes(1)

  await controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: ''},
  })
  expect(material.map).toBe(original)
  expect(secondDispose).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalled()
  controller.dispose()
})

test('texture load failures report the slot and property through onError', async () => {
  const {root} = modelWithTwoMeshes()
  cloneModelMaterials(root)
  const slots = collectMaterialSlots(root)
  const cause = new Error('unsupported image')
  const onError = jest.fn()
  const controller = createMaterialTextureController({
    getBlobUrl: async (blobId) => blobId,
    loadTexture: async () => {
      throw cause
    },
    onError,
    invalidate: () => {},
  })

  await controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'broken-texture'},
  })

  expect(onError).toHaveBeenCalledWith(cause, slots[0]!.slotId, 'mapBlobId')
  controller.dispose()
})

test('stale texture loads cannot overwrite a newer selection and are disposed', async () => {
  const {root, a} = modelWithTwoMeshes()
  cloneModelMaterials(root)
  const slots = collectMaterialSlots(root)
  const stale = new Texture()
  const current = new Texture()
  const staleDispose = jest.spyOn(stale, 'dispose')
  let resolveStale!: (texture: Texture) => void
  const controller = createMaterialTextureController({
    getBlobUrl: async (blobId) => blobId,
    loadTexture: (url) =>
      url === 'stale'
        ? new Promise((resolve) => {
            resolveStale = resolve
          })
        : Promise.resolve(current),
    invalidate: () => {},
  })

  const staleUpdate = controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'stale'},
  })
  await controller.update(root, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'current'},
  })
  resolveStale(stale)
  await staleUpdate

  expect((a.material as MeshStandardMaterial).map).toBe(current)
  expect(staleDispose).toHaveBeenCalledTimes(1)
  controller.dispose()
})

test('placed-instance teardown preserves shared original textures and disposes overrides once', async () => {
  const {root, a, b} = modelWithTwoMeshes()
  const original = new Texture()
  ;(a.material as MeshStandardMaterial).map = original
  ;(b.material as MeshStandardMaterial).map = original
  const first = SkeletonUtils.clone(root) as Group
  const second = SkeletonUtils.clone(root) as Group
  cloneModelMaterials(first)
  cloneModelMaterials(second)
  const slots = collectMaterialSlots(first)
  const override = new Texture()
  const originalDispose = jest.spyOn(original, 'dispose')
  const overrideDispose = jest.spyOn(override, 'dispose')
  const firstMaterial = (first.children[0] as Mesh)
    .material as MeshStandardMaterial
  const secondMaterial = (second.children[0] as Mesh)
    .material as MeshStandardMaterial
  const materialDispose = jest.spyOn(firstMaterial, 'dispose')
  const controller = createMaterialTextureController({
    getBlobUrl: async (blobId) => blobId,
    loadTexture: async () => override,
    invalidate: () => {},
  })
  await controller.update(first, slots, {
    [slots[0]!.slotKey]: {mapBlobId: 'override'},
  })

  controller.dispose()
  disposeObjectTree(first, {disposeTextures: false})

  expect(originalDispose).not.toHaveBeenCalled()
  expect(secondMaterial.map).toBe(original)
  expect(overrideDispose).toHaveBeenCalledTimes(1)
  expect(materialDispose).toHaveBeenCalledTimes(1)
})
