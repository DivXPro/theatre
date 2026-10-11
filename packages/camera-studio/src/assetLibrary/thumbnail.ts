import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import {createGLTFLoader} from './gltfLoader'
import type {ImportItem} from './importPipeline'
import type {Library} from './library'
import type {ModelEntry} from './types'

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
      const sphere = box.getBoundingSphere(new Sphere())
      const radius = sphere.radius || 1
      // 取景距离按包围球 + 垂直视场角算,保证整个模型(高瘦的人形
      // 尤其容易顶天)都进画面,再留 15% 呼吸边距
      const fov = 40
      const distance = (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.15
      const camera = new PerspectiveCamera(
        fov,
        1,
        distance / 100,
        distance * 10,
      )
      camera.position
        .copy(sphere.center)
        .add(new Vector3(0.7, 0.5, 0.7).normalize().multiplyScalar(distance))
      camera.lookAt(sphere.center)
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

/**
 * 给导入成功的 model 项补缩略图:按 contentHash 找回刚入库、
 * 还没有 thumbnailId 的条目逐个渲染。手动导入与内置播种共用。
 * WebGL 不可用时 renderThumbnail 返回 undefined,自然降级为占位图标。
 */
export async function backfillModelThumbnails(
  items: ImportItem[],
  library: Library,
): Promise<void> {
  for (const item of items) {
    if (item.type !== 'model') continue
    const blob = await renderThumbnail(item.glb)
    if (!blob) continue
    const list = (await library.listEntries('model')) as ModelEntry[]
    const entry = list.find(
      (e) => e.contentHash === item.contentHash && !e.thumbnailId,
    )
    if (entry) {
      await library.putBlobWithEntry(blob, (thumbnailId) => ({
        ...entry,
        thumbnailId,
      }))
    }
  }
}
