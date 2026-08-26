import {Document, WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {compressGLBDraco} from './draco'

/** 造一个 vertexCount 顶点的三角网格 GLB(不压缩) */
async function buildGLB(vertexCount: number): Promise<Uint8Array> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const positions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i) * i
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer)
  // Draco 需要显式索引才能稳定保留顶点数;用三角扇组织,顶点 0 为公共顶点。
  const indices = new Uint16Array(Math.max(0, (vertexCount - 2) * 3))
  for (let i = 0; i < vertexCount - 2; i++) {
    indices[i * 3] = 0
    indices[i * 3 + 1] = i + 1
    indices[i * 3 + 2] = i + 2
  }
  const index = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(indices)
    .setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setIndices(index)
  const mesh = doc.createMesh('m').addPrimitive(prim)
  const node = doc.createNode('n').setMesh(mesh)
  doc.createScene('s').addChild(node)
  return new WebIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc)
}

describe('compressGLBDraco', () => {
  it('压缩后体积更小且声明 draco 扩展', async () => {
    const glb = await buildGLB(5000)
    const raw = glb.buffer.slice(
      glb.byteOffset,
      glb.byteOffset + glb.byteLength,
    )
    const compressed = await compressGLBDraco(raw)
    expect(compressed.byteLength).toBeLessThan(glb.byteLength)
    const text = new TextDecoder().decode(new Uint8Array(compressed))
    expect(text).toContain('KHR_draco_mesh_compression')
  })

  it('读回后顶点数不丢', async () => {
    const glb = await buildGLB(5000)
    const raw = glb.buffer.slice(
      glb.byteOffset,
      glb.byteOffset + glb.byteLength,
    )
    const compressed = await compressGLBDraco(raw)
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3dgltf.createDecoderModule(),
      })
    const doc = await io.readBinary(new Uint8Array(compressed))
    const pos = doc
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute('POSITION')!
    expect(pos.getCount()).toBe(5000)
  })
})
