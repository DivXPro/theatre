import {WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {draco} from '@gltf-transform/functions'
import draco3dgltf from 'draco3dgltf'

/**
 * Draco 压缩的 IO 单例:wasm 模块编译一次,全局复用。
 * 用 draco3dgltf(浏览器端按 /draco/ 定位 wasm,node/jest 走 fs 直读);
 * draco3d 包的 main 是 node 专用实现,浏览器里会读 fs,不要用。
 */
let ioPromise: Promise<WebIO> | undefined

async function initIO(): Promise<WebIO> {
  // 浏览器里胶水按页面 URL 相对路径取 wasm 会 404,指到 vite 服务的 /draco/;
  // node(jest)里胶水走 fs 直读,不能给它 locateFile
  const wasmOpts =
    typeof window === 'undefined'
      ? undefined
      : {locateFile: (file: string) => `/draco/${file}`}
  const [decoder, encoder] = await Promise.all([
    draco3dgltf.createDecoderModule(wasmOpts),
    draco3dgltf.createEncoderModule(wasmOpts),
  ])
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': decoder,
    'draco3d.encoder': encoder,
  })
}

function getIO(): Promise<WebIO> {
  ioPromise ??= initIO().catch((err) => {
    // 初始化失败不缓存(wasm 404 等瞬时故障),下次调用重试
    ioPromise = undefined
    throw err
  })
  return ioPromise
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
