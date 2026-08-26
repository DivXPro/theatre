import {WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {draco} from '@gltf-transform/functions'
import draco3dgltf from 'draco3dgltf'

/**
 * Draco 压缩的 IO 单例:wasm 模块编译一次,全局复用。
 * 用 draco3dgltf(wasm 内嵌 base64,浏览器/节点都能跑);
 * draco3d 包的 main 是 node 专用实现,浏览器里会读 fs,不要用。
 */
let ioPromise: Promise<WebIO> | undefined

function getIO(): Promise<WebIO> {
  return (ioPromise ??= (async () => {
    const [decoder, encoder] = await Promise.all([
      draco3dgltf.createDecoderModule(),
      draco3dgltf.createEncoderModule(),
    ])
    return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'draco3d.decoder': decoder,
      'draco3d.encoder': encoder,
    })
  })())
}

/**
 * Draco 压缩 GLB(只压网格几何,骨骼/动画轨道不受影响)。
 * 无网格的动作 GLB 没有可压内容,调用方不应走这里。
 */
export async function compressGLBDraco(glb: ArrayBuffer): Promise<ArrayBuffer> {
  const io = await getIO()
  const doc = await io.readBinary(new Uint8Array(glb))
  await doc.transform(draco())
  const out = await io.writeBinary(doc)
  // writeBinary 返回的 Uint8Array 可能带偏移,切出干净的 ArrayBuffer
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}
