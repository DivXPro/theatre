import {importModelFiles} from './importModelFiles'
import {Library} from './library'
import type {LibraryBackend, LibraryEntry} from './types'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function triangleGltf(): File {
  const document = {
    asset: {version: '2.0'},
    scene: 0,
    scenes: [{nodes: [0]}],
    nodes: [{mesh: 0}],
    meshes: [
      {
        primitives: [{attributes: {POSITION: 0}, material: 0, mode: 4}],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {index: 0},
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    textures: [{source: 0}],
    images: [{uri: 'textures/tiny.png'}],
    buffers: [{uri: 'geometry/triangle.bin', byteLength: 36}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  }
  return new File([JSON.stringify(document)], 'triangle.gltf', {
    type: 'model/gltf+json',
  })
}

function triangleBin(): File {
  const bytes = new ArrayBuffer(36)
  const positions = new Float32Array(bytes)
  positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0])
  return new File([bytes], 'triangle.bin', {
    type: 'application/octet-stream',
  })
}

function tinyPngFile(): File {
  return new File([tinyPng], 'tiny.png', {type: 'image/png'})
}

function memoryBackend() {
  const entries = new Map<string, LibraryEntry>()
  const blobs = new Map<string, Blob>()
  const backend = {
    id: 'mock',
    listEntries: async (kind?: LibraryEntry['kind']) =>
      [...entries.values()].filter((entry) => !kind || entry.kind === kind),
    getEntry: async (id: string) => entries.get(id),
    putEntry: async (entry: LibraryEntry) => void entries.set(entry.id, entry),
    deleteEntry: async (id: string) => void entries.delete(id),
    putBlob: async (blob: Blob) => {
      const id = `blob-${blobs.size}`
      blobs.set(id, blob)
      return id
    },
    getBlobUrl: async () => 'blob:stored',
    deleteBlob: async (id: string) => void blobs.delete(id),
    listBlobIds: async () => [...blobs.keys()],
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  } as LibraryBackend
  return {backend, entries, blobs}
}

function gltfJsonChunk(glb: ArrayBuffer) {
  const view = new DataView(glb)
  const jsonLength = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)),
  )
}

describe('importModelFiles', () => {
  const originalFetch = globalThis.fetch
  const originalSelf = globalThis.self
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalImageData = globalThis.ImageData
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalCreateElement = document.createElement
  let objectUrls: Map<string, Blob>

  beforeEach(() => {
    globalThis.self = globalThis as unknown as Window & typeof globalThis
    let nextId = 0
    objectUrls = new Map()
    URL.createObjectURL = jest.fn((blob: Blob) => {
      const url = `blob:test-${++nextId}`
      objectUrls.set(url, blob)
      return url
    })
    URL.revokeObjectURL = jest.fn((url: string) => {
      objectUrls.delete(url)
    })
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' || input instanceof URL
          ? String(input)
          : input.url
      const blob = objectUrls.get(url)
      if (!blob) throw new Error(`未登记的测试 URL: ${url}`)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        url,
        headers: {get: () => null},
        arrayBuffer: () => blob.arrayBuffer(),
        blob: async () => blob,
      } as unknown as Response
    })
    globalThis.createImageBitmap = jest.fn(async () => ({
      data: new Uint8ClampedArray([255, 255, 255, 255]),
      width: 1,
      height: 1,
      close: jest.fn(),
    })) as unknown as typeof createImageBitmap
    globalThis.ImageData = class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    } as typeof ImageData
    document.createElement = jest.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => ({
        translate: jest.fn(),
        scale: jest.fn(),
        drawImage: jest.fn(),
        putImageData: jest.fn(),
      }),
      toBlob: (callback: BlobCallback) =>
        callback(new Blob([tinyPng], {type: 'image/png'})),
    })) as unknown as typeof document.createElement
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.self = originalSelf
    globalThis.createImageBitmap = originalCreateImageBitmap
    globalThis.ImageData = originalImageData
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    if (originalCreateElement) document.createElement = originalCreateElement
    else Reflect.deleteProperty(document, 'createElement')
  })

  it('把相对 buffer/image 一起装入一个自包含 GLB,并回收全部临时 URL', async () => {
    const {backend, entries, blobs} = memoryBackend()
    const library = new Library({sources: [backend]})

    const imported = await importModelFiles(
      [triangleGltf(), triangleBin(), tinyPngFile()],
      library,
    )

    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      kind: 'model',
      name: 'triangle',
      vertexCount: 3,
    })
    expect(entries.size).toBe(1)
    const glb = await blobs.get(imported[0].blobId)!.arrayBuffer()
    expect(new DataView(glb).getUint32(0, true)).toBe(0x46546c67)
    const json = gltfJsonChunk(glb)
    expect(json.buffers[0].uri).toBeUndefined()
    expect(json.images[0].uri).toBeUndefined()
    expect(json.images[0].bufferView).toEqual(expect.any(Number))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(objectUrls.size).toBe(0)
  })

  it('引用的 bin 缺失时不创建任何新条目,并回收已创建的 URL', async () => {
    const {backend, entries} = memoryBackend()
    const library = new Library({sources: [backend]})

    await expect(
      importModelFiles([triangleGltf(), tinyPngFile()], library),
    ).rejects.toThrow()
    expect(entries.size).toBe(0)
    expect(objectUrls.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      expect.stringMatching(/^blob:test-/),
    )
  })
})
