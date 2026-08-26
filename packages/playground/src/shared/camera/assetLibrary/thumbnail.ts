import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import {createGLTFLoader} from './gltfLoader'

/**
 * 离屏渲染模型缩略图(128×128 PNG)。WebGL 上下文创建失败、
 * 解析失败等情况一律返回 undefined,调用方降级为图标占位。
 */
export async function renderThumbnail(
  glb: ArrayBuffer,
): Promise<Blob | undefined> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    })
    try {
      const scene = new Scene()
      scene.add(new AmbientLight(0xffffff, 1.4))
      const dir = new DirectionalLight(0xffffff, 1.6)
      dir.position.set(3, 5, 4)
      scene.add(dir)

      const gltf = await new Promise<{scene: import('three').Group}>(
        (resolve, reject) => createGLTFLoader().parse(glb, '', resolve, reject),
      )
      scene.add(gltf.scene)

      const box = new Box3().setFromObject(gltf.scene)
      const center = box.getCenter(new Vector3())
      const size = box.getSize(new Vector3()).length() || 1
      const camera = new PerspectiveCamera(40, 1, size / 100, size * 10)
      camera.position
        .copy(center)
        .add(new Vector3(size * 0.7, size * 0.5, size * 0.7))
      camera.lookAt(center)
      renderer.render(scene, camera)

      return await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob((b) => resolve(b ?? undefined), 'image/png'),
      )
    } finally {
      renderer.dispose()
    }
  } catch {
    return undefined
  }
}
