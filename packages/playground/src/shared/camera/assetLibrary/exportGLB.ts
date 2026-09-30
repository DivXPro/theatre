import {Bone, Group} from 'three'
import type {AnimationClip, Mesh, Object3D, Texture} from 'three'
import {GLTFExporter} from 'three-stdlib'
import {compressGLBDraco} from './draco'

/**
 * 移除无法导出的贴图(image 数据缺失)。
 * FBX 常引用本机不存在的外部贴图文件,加载失败后留下 image 为空的 Texture,
 * GLTFExporter 遇到会直接抛错("No valid image data found")拖垮整个导入。
 * 剥掉这些贴图后以灰模/部分贴图入库,不阻塞导入(P1 设计既定取舍)。
 * 返回移除数量,供调用方告警。
 */
export function stripInvalidTextures(root: Object3D): number {
  let stripped = 0
  root.traverse((obj) => {
    if (!(obj as Mesh).isMesh) return
    const {material} = obj as Mesh
    const materials = Array.isArray(material) ? material : [material]
    for (const mat of materials) {
      if (!mat) continue
      for (const [key, value] of Object.entries(mat)) {
        const tex = value as Texture
        if (!tex?.isTexture) continue
        // 与 GLTFExporter.processImage 可处理的形态对齐:
        // ImageData 类(带 data)或可绘制类(带宽高的 image/canvas/bitmap)
        const img = tex.image as
          | {data?: unknown; width?: number; height?: number}
          | null
          | undefined
        const valid =
          img != null &&
          (img.data !== undefined ||
            ((img.width ?? 0) > 0 && (img.height ?? 0) > 0))
        if (!valid) {
          ;(mat as unknown as Record<string, unknown>)[key] = null
          stripped++
        }
      }
    }
  })
  return stripped
}

/**
 * 克隆纯骨骼层级(容器名 AnimationRig):动画轨道按骨骼名寻址,
 * 纯动画 GLB 只需要这棵带名字的骨骼树,网格一律剔除。
 */
export function cloneBoneTree(root: Object3D): Group {
  const container = new Group()
  container.name = 'AnimationRig'
  const cloneBone = (bone: Bone): Bone => {
    const copy = new Bone()
    copy.name = bone.name
    copy.position.copy(bone.position)
    copy.quaternion.copy(bone.quaternion)
    copy.scale.copy(bone.scale)
    for (const child of bone.children) {
      if ((child as Bone).isBone) copy.add(cloneBone(child as Bone))
    }
    return copy
  }
  root.traverse((obj) => {
    if ((obj as Bone).isBone && !(obj.parent as Bone)?.isBone) {
      container.add(cloneBone(obj as Bone))
    }
  })
  return container
}

function exportGLB(
  root: Object3D,
  animations: AnimationClip[],
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      {binary: true, animations},
    )
  })
}

/** 模型入库:剥掉动画,只留网格+骨架+绑定姿势;几何走 Draco 压缩 */
export function exportModelGLB(root: Object3D): Promise<ArrayBuffer> {
  const stripped = stripInvalidTextures(root)
  if (stripped > 0) {
    console.warn(
      `[assetLibrary] ${stripped} 张贴图数据无效(源文件引用的贴图缺失或加载失败),已移除后继续导出,模型将以灰模/部分贴图入库`,
    )
  }
  return exportGLB(root, []).then(compressGLBDraco)
}

/** 动作入库:骨骼树克隆 + 单条动画,不含网格 */
export function exportAnimationGLB(
  root: Object3D,
  clip: AnimationClip,
): Promise<ArrayBuffer> {
  return exportGLB(cloneBoneTree(root), [clip])
}
