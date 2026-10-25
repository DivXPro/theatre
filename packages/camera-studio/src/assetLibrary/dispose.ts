import type {Material, Object3D, Texture} from 'three'

/** 递归释放对象树的 GPU 资源;纹理默认随材质释放,共享纹理的克隆实例可关闭 */
export function disposeObjectTree(
  root: Object3D,
  options: {disposeTextures?: boolean} = {},
): void {
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
      if (options.disposeTextures !== false) {
        for (const v of Object.values(m)) {
          if ((v as Texture | null)?.isTexture) (v as Texture).dispose()
        }
      }
      m.dispose()
    }
  })
}
