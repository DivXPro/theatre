import {Bone, Group} from 'three'
import type {AnimationClip, Object3D} from 'three'
import {GLTFExporter} from 'three-stdlib'
import {compressGLBDraco} from './draco'

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
  return exportGLB(root, []).then(compressGLBDraco)
}

/** 动作入库:骨骼树克隆 + 单条动画,不含网格 */
export function exportAnimationGLB(
  root: Object3D,
  clip: AnimationClip,
): Promise<ArrayBuffer> {
  return exportGLB(cloneBoneTree(root), [clip])
}
