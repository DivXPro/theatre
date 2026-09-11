/**
 * 内置路径预设:4 种几何形状,给落点返回一串世界坐标路径点。
 * 纯函数,无 React/theatre 依赖。预设不可删改、不可自定义(用户决策)。
 *
 * 路径是相机轨迹:点都在 y = center.y 的水平面上(高度由调用方取
 * 活动相机当前 Y)。直线往返的"往返"由行进进度回摆实现,点列不重复。
 */
import type {Vec3Like} from './pathModel'

export type PathPreset = {
  id: 'circle' | 'line' | 'arc' | 'figure8'
  name: string
  icon: string
}

export const PATH_PRESETS: readonly PathPreset[] = [
  {id: 'circle', name: '环绕圆', icon: '⭕'},
  {id: 'line', name: '直线往返', icon: '↔️'},
  {id: 'arc', name: '弧线', icon: '◠'},
  {id: 'figure8', name: '8 字', icon: '♾️'},
]

const TAU = Math.PI * 2

/** 给落点返回该形状的路径点(世界坐标,共面于 y = center.y) */
export function presetPoints(preset: PathPreset, center: Vec3Like): Vec3Like[] {
  const {x: cx, y, z: cz} = center
  switch (preset.id) {
    case 'circle': {
      const r = 5
      const n = 8
      return Array.from({length: n}, (_, i) => {
        const a = (i / n) * TAU
        return {x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a)}
      })
    }
    case 'line':
      return [
        {x: cx - 5, y, z: cz},
        {x: cx + 5, y, z: cz},
      ]
    case 'arc': {
      const r = 6
      const n = 5
      return Array.from({length: n}, (_, i) => {
        const a = (i / (n - 1)) * Math.PI
        return {x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a)}
      })
    }
    case 'figure8': {
      const r = 3
      const per = 6
      const pts: Vec3Like[] = []
      // 左圆:圆心 (cx - r, cz),右缘过落点
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({x: cx - r + r * Math.cos(a), y, z: cz + r * Math.sin(a)})
      }
      // 右圆:圆心 (cx + r, cz),左缘过落点
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({x: cx + r - r * Math.cos(a), y, z: cz + r * Math.sin(a)})
      }
      return pts
    }
  }
}

/**
 * 模型点击放置的默认位:base(默认原点)被占时沿 +X 每次错开 2。
 * XZ 平面距离小于 1.5 视为占用;100 次保底防死循环。
 */
export function findFreeSpot(
  occupied: readonly Vec3Like[],
  base: Vec3Like = {x: 0, y: 0, z: 0},
): Vec3Like {
  const CLEAR_RADIUS = 1.5
  const STEP = 2
  let spot = {...base}
  for (let guard = 0; guard < 100; guard++) {
    const clash = occupied.some(
      (p) => Math.hypot(p.x - spot.x, p.z - spot.z) < CLEAR_RADIUS,
    )
    if (!clash) return spot
    spot = {x: spot.x + STEP, y: base.y, z: base.z}
  }
  return spot
}
