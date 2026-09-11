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
): Vector3 {
  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  // 表面优先:只对登记过的落点表面检测,只认 Mesh 命中
  const surface = raycaster
    .intersectObjects([...surfaces], true)
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
    return surface.point
  }
  if (usableGround) return usableGround
  // 视线与地面平行、朝天、或贴地:放到正前方 30 个单位、压到地面
  const ahead = raycaster.ray.at(30, new Vector3())
  ahead.y = 0
  return ahead
}
