/*
 * @jest-environment jsdom
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {Group} from 'three'
import type {MaterialSlot} from './types'

let projectSeq = 0

jest.doMock('three', () => {
  const actual = jest.requireActual('three') as typeof import('three')
  return {
    ...actual,
    TextureLoader: class {
      async loadAsync(_url: string) {
        const texture = new actual.Texture()
        loadedTextures.push(texture)
        return texture
      }
    },
  }
})

jest.doMock('../assetLibrary/library', () => ({
  ...jest.requireActual('../assetLibrary/library'),
  getLibrary: () => ({getBlobUrl: async (blobId: string) => blobId}),
}))

const loadedTextures: import('three').Texture[] = []
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
const React = require('react') as typeof import('react')
const ReactDOM =
  require('react-dom/client') as typeof import('react-dom/client')
const core = require('@dreamerbird/core') as typeof import('@dreamerbird/core')
const three = require('three') as typeof import('three')
const {useModelMaterials} =
  require('./useModelMaterials') as typeof import('./useModelMaterials')
const {
  cloneModelMaterials,
  collectMaterialSlots,
  createMaterialOverridesConfig,
} = require('./modelMaterials') as typeof import('./modelMaterials')

function makeInstance() {
  const instance = new three.Group()
  const mesh = new three.Mesh(
    new three.BoxGeometry(),
    new three.MeshStandardMaterial(),
  )
  mesh.name = 'Body'
  instance.add(mesh)
  cloneModelMaterials(instance)
  return instance
}

function Harness({
  instance,
  slots,
  sheetObject,
}: {
  instance: Group
  slots: MaterialSlot[]
  sheetObject: ISheetObject<any>
}) {
  useModelMaterials({instance, slots, sheetObject, invalidate: () => {}})
  return null
}

test('instance replacement disposes the previous controller textures', async () => {
  loadedTextures.length = 0
  const first = makeInstance()
  const second = makeInstance()
  const firstSlots = collectMaterialSlots(first)
  const secondSlots = collectMaterialSlots(second)
  const project = core.getProject(`material-hook-${++projectSeq}`)
  const sheetObject = project.sheet('Scene').object('Foo', {
    materialOverrides: createMaterialOverridesConfig(firstSlots),
  })
  sheetObject.initialValue = {
    materialOverrides: {
      [firstSlots[0]!.slotKey]: {
        ...firstSlots[0]!.values,
        mapBlobId: 'override',
      },
    },
  }
  const element = document.createElement('div')
  const root = ReactDOM.createRoot(element)

  try {
    await React.act(async () => {
      root.render(
        <Harness
          instance={first}
          slots={firstSlots}
          sheetObject={sheetObject}
        />,
      )
    })
    const oldTexture = loadedTextures[0]!
    const oldDispose = jest.spyOn(oldTexture, 'dispose')

    await React.act(async () => {
      root.render(
        <Harness
          instance={second}
          slots={secondSlots}
          sheetObject={sheetObject}
        />,
      )
    })

    expect(loadedTextures).toHaveLength(2)
    expect(oldDispose).toHaveBeenCalledTimes(1)
  } finally {
    await React.act(async () => root.unmount())
  }
})
