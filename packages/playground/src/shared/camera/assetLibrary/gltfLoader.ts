import {DRACOLoader, GLTFLoader} from 'three-stdlib'

let dracoLoader: DRACOLoader | undefined

/**
 * 统一创建 GLTFLoader:接 Draco 解码(解码器文件在 public/draco,
 * 从 three 原样拷贝)。未压缩的 GLB 走原路径,不受影响;
 * DRACOLoader 全局一个,解码 wasm 只加载一次。
 */
export function createGLTFLoader(): GLTFLoader {
  dracoLoader ??= new DRACOLoader().setDecoderPath('/draco/')
  return new GLTFLoader().setDRACOLoader(dracoLoader)
}
