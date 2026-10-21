import {Bone, Box3, Group, Vector3} from 'three'
import type {AnimationClip, Mesh, Object3D, Texture} from 'three'
import {GLTFExporter} from 'three-stdlib'
import {compressGLBDraco} from './draco'

/**
 * 场景单位 = 米(2026-10-21 起,替代此前「最长边统一拉成 5 单位」的
 * 归一化约定)。glTF 标准本来就是米,人高 1.8 单位、网格 1 小格 = 1 米,
 * 模型之间保持真实世界的相对大小(车 4.5 / 人 1.8 / 杯子 0.1)。
 * PlacementManager 的 useNormalizedModel 用同一套换算兜底未烘焙来源。
 */
export const SCENE_UNIT_METERS = 1

/**
 * 厘米源判定阈值:最长边超过这个数就按厘米源处理(÷100)。
 * Mixamo 等 FBX 是厘米(人 180),标准 GLB 是米(人 1.8)。取 50 是因为
 * 米制模型最长边到 50(=50 米,一栋楼)在本系统里罕见,而厘米源几乎
 * 都远超(一个人就 180)。猜错的入口(超大道具/建筑)保留手动改缩放。
 */
export const CENTIMETER_SOURCE_THRESHOLD = 50

/** 源尺寸最长边 → 米制换算系数(米源返回 1,厘米源返回 0.01) */
export function metricScaleFactor(maxDim: number): number {
  return maxDim > CENTIMETER_SOURCE_THRESHOLD ? 0.01 : SCENE_UNIT_METERS
}

/**
 * 把「源单位 → 米」的换算系数烘进根节点 scale(入库前置)。
 * 源文件单位五花八门(Mixamo FBX 是厘米、GLB 多是米),烘过之后任何
 * 模型都是真实米制尺寸,放置时 theatre 对象的缩放属性才能以 1 为
 * 干净基线(1 = 真实大小,2 = 两倍大)。只动根节点变换:蒙皮随骨骼
 * 世界变换正确缩放,骨骼局部数据(动画轨道寻址的那层)不受影响。
 * 返回应用的系数(1 = 本来就是米,没动)。
 */
export function bakeMetricScale(root: Object3D): number {
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (!(maxDim > 0)) return 1
  const factor = metricScaleFactor(maxDim)
  if (factor === 1) return 1
  root.scale.multiplyScalar(factor)
  return factor
}

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
  const factor = bakeMetricScale(root)
  if (factor !== 1) {
    console.info(
      `[assetLibrary] 已把源尺寸换算成米烘进模型(系数 ${factor.toFixed(
        4,
      )}),放置时缩放基线为 1 = 真实大小`,
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
