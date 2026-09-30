/**
 * 指针位置 → 场景落点:登记过的物体表面优先,y=0 地面(数学平面,无限大)
 * 兜底,视线朝天/贴地时退到"前方 30 个单位、压到地面"——任何视角都有落点。
 * 从 PlacementRigCore 抽出,模型放置幽灵和路径预设落点标记共用。
 *
 * 不用不可见网格接事件:视线与地面平行时网格永远打不中,事件根本不触发。
 */
import {Plane, Vector2, Vector3} from 'three'
import type {Camera, Mesh, Object3D, Raycaster} from 'three'

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0)

export function computeDropPoint(
  raycaster: Raycaster,
  camera: Camera,
  surfaces: Iterable<Object3D>,
  rect: {left: number; top: number; width: number; height: number},
  clientX: number,
  clientY: number,
  /** 表面分支胜出时回填命中的登记根(命中网格往上走到 surfaces 里的祖先) */
  out?: {surfaceRoot: Object3D | null},
): Vector3 {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  // 表面优先:只对登记过的落点表面检测,只认 Mesh 命中
  const roots = [...surfaces]
  const surface = raycaster
    .intersectObjects(roots, true)
    .find((h) => (h.object as Mesh).isMesh)
  const ground = raycaster.ray.intersectPlane(GROUND_PLANE, new Vector3())
  // 相机贴地(y≈0)时地面会在"相机脚下"命中(t≈0),这个命中比任何
  // 表面都"近"但就在相机自己身上,没有放置意义——半单位以内丢弃
  const usableGround =
    ground && raycaster.ray.origin.distanceTo(ground) > 0.5 ? ground : null
  if (
    surface &&
    (!usableGround ||
      surface.distance <= raycaster.ray.origin.distanceTo(usableGround))
  ) {
    if (out) {
      const rootSet = new Set(roots)
      let node: Object3D | null = surface.object
      while (node && !rootSet.has(node)) node = node.parent
      out.surfaceRoot = node
    }
    return surface.point
  }
  if (out) out.surfaceRoot = null
  if (usableGround) return usableGround
  // 视线与地面平行、朝天、或贴地:放到正前方 30 个单位、压到地面
  const ahead = raycaster.ray.at(30, new Vector3())
  ahead.y = 0
  return ahead
}

/**
 * 指针位置 → 视平面落点(Blender G 抓取的默认语义):指针射线与
 * 「过锚点、垂直于视线的平面」求交。视平面随相机倾斜,指针上移 =
 * 世界里升高,高度自由;顶视时平面水平,退化为纯水平移动(同 Blender
 * 顶视图里 G 只能平移)。射线与平面平行/平面退到相机身后时返回 null,
 * 调用方保持上一帧点位不动。
 */
export function computeViewPlanePoint(
  raycaster: Raycaster,
  camera: Camera,
  rect: {left: number; top: number; width: number; height: number},
  clientX: number,
  clientY: number,
  /** 视平面锚点:决定平面的深度和基准高度(拖动开始时的落点) */
  anchor: Vector3,
): Vector3 | null {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const forward = camera.getWorldDirection(new Vector3())
  const plane = new Plane().setFromNormalAndCoplanarPoint(forward, anchor)
  return raycaster.ray.intersectPlane(plane, new Vector3())
}

/**
 * 竖直轴向约束(Blender 拖动中按 Z):锁定基准点的 x/z,指针控制 y。
 * 取「过基准点的竖直线」与指针射线的最近点参数——射线到轴线的垂足即
 * 手感上"指针所指的高度"。视线与竖直轴平行(正顶/正仰视)时无解,返回
 * null,调用方保持上一帧点位。
 */
export function computeVerticalConstraintPoint(
  raycaster: Raycaster,
  camera: Camera,
  rect: {left: number; top: number; width: number; height: number},
  clientX: number,
  clientY: number,
  /** 约束基准点:x/z 被锁定为它,y 从它起算 */
  base: Vector3,
): Vector3 | null {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const ro = raycaster.ray.origin
  const rd = raycaster.ray.direction // 单位向量
  // 线-线最近点:轴线 L = base + t·(0,1,0),射线 R = ro + s·rd。
  // 对 |L−R|² 求偏导得 t(1−b²) = w0.y − e·b,其中 b = rd.y,
  // w0 = ro − base,e = w0·rd
  const b = rd.y
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-6) return null
  const w0 = new Vector3().subVectors(ro, base)
  const e = w0.dot(rd)
  const t = (w0.y - e * b) / denom
  return new Vector3(base.x, base.y + t, base.z)
}

/**
 * 水平面约束(Blender 拖动中按 Shift+Z):锁定基准点的 y,指针在
 * 水平面内自由移动 x/z。视线与水平面平行时无解,返回 null。
 */
export function computeHorizontalConstraintPoint(
  raycaster: Raycaster,
  camera: Camera,
  rect: {left: number; top: number; width: number; height: number},
  clientX: number,
  clientY: number,
  /** 约束基准点:y 被锁定为它 */
  base: Vector3,
): Vector3 | null {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const plane = new Plane(new Vector3(0, 1, 0), -base.y)
  return raycaster.ray.intersectPlane(plane, new Vector3())
}
