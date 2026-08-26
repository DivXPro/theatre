import type {Material, Object3D, Texture} from 'three'

/** 递归释放对象树的 GPU 资源(几何体/材质/纹理),实例卸载时调用 */
export function disposeObjectTree(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as {
      isMesh?: boolean
      geometry?: {dispose(): void}
      material?: Material | Material[]
    }
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    for (const m of mats) {
      for (const v of Object.values(m)) {
        if ((v as Texture | null)?.isTexture) (v as Texture).dispose()
      }
      m.dispose()
    }
  })
}
