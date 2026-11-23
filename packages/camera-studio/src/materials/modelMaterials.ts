import {types as t} from '@dreamerbird/core'
import {
  Mesh,
  SRGBColorSpace,
  type Texture,
  type Material,
  type Object3D,
} from 'three'
import type {MaterialSlot, MaterialValues} from './types'

const textureProperties = [
  ['mapBlobId', 'map'],
  ['normalMapBlobId', 'normalMap'],
  ['roughnessMapBlobId', 'roughnessMap'],
  ['metalnessMapBlobId', 'metalnessMap'],
  ['emissiveMapBlobId', 'emissiveMap'],
] as const

type TextureProperty = (typeof textureProperties)[number][1]
type MaterialOverrides = Record<string, Partial<MaterialValues>>

type OriginalMaterialState = {
  maps: Partial<Record<TextureProperty, Texture | null>>
  transparent: boolean
}

const originalStates = new WeakMap<Material, OriginalMaterialState>()
const configCache = new WeakMap<MaterialSlot[], any>()

function materialRecord(material: Material) {
  return material as unknown as Record<string, unknown>
}

function rememberOriginal(material: Material): OriginalMaterialState {
  const existing = originalStates.get(material)
  if (existing) return existing
  const record = materialRecord(material)
  const state: OriginalMaterialState = {
    maps: {},
    transparent: material.transparent,
  }
  for (const [, property] of textureProperties) {
    state.maps[property] = (record[property] as Texture | undefined) ?? null
  }
  originalStates.set(material, state)
  return state
}

function slotKey(slotId: string, meshName: string): string {
  let hash = 2166136261
  for (let index = 0; index < slotId.length; index++) {
    hash ^= slotId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const name = meshName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'mesh'
  return `${name}_${(hash >>> 0).toString(36)}`
}

function materialValues(material: Material): MaterialValues {
  const record = materialRecord(material)
  const color = record.color as {getHexString(): string} | undefined
  const emissive = record.emissive as {getHexString(): string} | undefined
  return {
    color: `#${color?.getHexString() ?? 'ffffff'}`,
    metalness: typeof record.metalness === 'number' ? record.metalness : 0,
    roughness: typeof record.roughness === 'number' ? record.roughness : 1,
    emissive: `#${emissive?.getHexString() ?? '000000'}`,
    opacity: material.opacity,
    mapBlobId: '',
    normalMapBlobId: '',
    roughnessMapBlobId: '',
    metalnessMapBlobId: '',
    emissiveMapBlobId: '',
  }
}

export function cloneModelMaterials(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const clone = (material: Material) => {
      const cloned = material.clone()
      rememberOriginal(cloned)
      return cloned
    }
    object.material = Array.isArray(object.material)
      ? object.material.map(clone)
      : clone(object.material)
  })
}

export function collectMaterialSlots(root: Object3D): MaterialSlot[] {
  const slots: MaterialSlot[] = []
  const visit = (object: Object3D, path: number[]) => {
    if (object instanceof Mesh) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      materials.forEach((material, materialIndex) => {
        rememberOriginal(material)
        const slotId = `${path.join('/') || 'root'}:${materialIndex}`
        slots.push({
          slotId,
          slotKey: slotKey(slotId, object.name),
          meshName: object.name,
          materialName: material.name,
          values: materialValues(material),
        })
      })
    }
    object.children.forEach((child, index) => visit(child, [...path, index]))
  }
  visit(root, [])
  return slots
}

function bindings(root: Object3D, slots: MaterialSlot[]) {
  const byId = new Map(slots.map((slot) => [slot.slotId, slot]))
  const result: Array<{slot: MaterialSlot; material: Material}> = []
  const visit = (object: Object3D, path: number[]) => {
    if (object instanceof Mesh) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      materials.forEach((material, materialIndex) => {
        const slot = byId.get(`${path.join('/') || 'root'}:${materialIndex}`)
        if (slot) result.push({slot, material})
      })
    }
    object.children.forEach((child, index) => visit(child, [...path, index]))
  }
  visit(root, [])
  return result
}

export function applyMaterialScalars(
  root: Object3D,
  slots: MaterialSlot[],
  overrides: MaterialOverrides,
): void {
  for (const {slot, material} of bindings(root, slots)) {
    const values = overrides[slot.slotKey]
    if (!values) continue
    const record = materialRecord(material)
    if (values.color !== undefined) {
      ;(record.color as {set(value: string): void} | undefined)?.set(
        values.color,
      )
    }
    if (values.emissive !== undefined) {
      ;(record.emissive as {set(value: string): void} | undefined)?.set(
        values.emissive,
      )
    }
    for (const property of ['metalness', 'roughness'] as const) {
      const value = values[property]
      if (value !== undefined && typeof record[property] === 'number') {
        record[property] = value
      }
    }
    if (values.opacity !== undefined) {
      material.opacity = values.opacity
      const original = rememberOriginal(material)
      const transparent = original.transparent || values.opacity < 1
      if (material.transparent !== transparent) {
        material.transparent = transparent
        material.needsUpdate = true
      }
    }
  }
}

function scalarConfig(values: MaterialValues) {
  return {
    color: t.string(values.color),
    metalness: t.number(values.metalness, {range: [0, 1]}),
    roughness: t.number(values.roughness, {range: [0, 1]}),
    emissive: t.string(values.emissive),
    opacity: t.number(values.opacity, {range: [0, 1]}),
    mapBlobId: t.string(''),
    normalMapBlobId: t.string(''),
    roughnessMapBlobId: t.string(''),
    metalnessMapBlobId: t.string(''),
    emissiveMapBlobId: t.string(''),
  }
}

export function createMaterialOverridesConfig(slots: MaterialSlot[]) {
  const cached = configCache.get(slots)
  if (cached) return cached
  const config = t.compound(
    Object.fromEntries(
      slots.map((slot) => [
        slot.slotKey,
        t.compound(scalarConfig(slot.values), {
          label: `${slot.meshName || 'Mesh'} / ${
            slot.materialName || 'Material'
          }`,
        }),
      ]),
    ),
    {label: 'Materials', hidden: true},
  )
  configCache.set(slots, config)
  return config
}

type TextureControllerOptions = {
  getBlobUrl(blobId: string): Promise<string>
  loadTexture(url: string): Promise<Texture>
  onError?(error: unknown, slotId: string, property: string): void
  invalidate(): void
}

export function createMaterialTextureController(
  options: TextureControllerOptions,
) {
  let generation = 0
  let disposed = false
  const loaded = new Map<
    Material,
    Partial<Record<TextureProperty, {blobId: string; texture: Texture}>>
  >()

  const disposeEntry = (material: Material, property: TextureProperty) => {
    const entry = loaded.get(material)?.[property]
    if (!entry) return
    entry.texture.dispose()
    delete loaded.get(material)![property]
  }

  const updateTexture = async (
    material: Material,
    property: TextureProperty,
    blobId: string,
    token: number,
  ) => {
    const original = rememberOriginal(material)
    const record = materialRecord(material)
    if (!blobId) {
      const originalMap = original.maps[property] ?? null
      if (
        record[property] !== originalMap ||
        loaded.get(material)?.[property]
      ) {
        material.needsUpdate = true
      }
      record[property] = originalMap
      disposeEntry(material, property)
      return
    }
    if (loaded.get(material)?.[property]?.blobId === blobId) return
    const url = await options.getBlobUrl(blobId)
    const texture = await options.loadTexture(url)
    if (disposed || token !== generation) {
      texture.dispose()
      return
    }
    texture.colorSpace =
      property === 'map' || property === 'emissiveMap'
        ? SRGBColorSpace
        : texture.colorSpace
    disposeEntry(material, property)
    record[property] = texture
    material.needsUpdate = true
    const entries = loaded.get(material) ?? {}
    entries[property] = {blobId, texture}
    loaded.set(material, entries)
  }

  return {
    async update(
      root: Object3D,
      slots: MaterialSlot[],
      overrides: MaterialOverrides,
    ): Promise<void> {
      const token = ++generation
      const tasks: Promise<void>[] = []
      for (const {slot, material} of bindings(root, slots)) {
        const values = overrides[slot.slotKey]
        if (!values) continue
        for (const [blobProperty, property] of textureProperties) {
          const blobId = values[blobProperty]
          if (blobId === undefined) continue
          tasks.push(
            updateTexture(material, property, blobId, token).catch((error) => {
              if (!disposed && token === generation) {
                if (options.onError) {
                  options.onError(error, slot.slotId, blobProperty)
                } else {
                  console.warn(
                    `[materials] 贴图加载失败: ${slot.slotId}/${blobProperty}`,
                    error,
                  )
                }
              }
            }),
          )
        }
      }
      await Promise.all(tasks)
      if (!disposed && token === generation) options.invalidate()
    },
    dispose(): void {
      disposed = true
      generation++
      for (const [material, entries] of loaded) {
        for (const property of Object.keys(entries) as TextureProperty[]) {
          disposeEntry(material, property)
        }
      }
      loaded.clear()
    },
  }
}
