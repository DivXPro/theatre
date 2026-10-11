/**
 * 内置路径预设:几何形状 + 经典运镜,给落点返回一串世界坐标路径点。
 * 纯函数,无 React/theatre 依赖。预设不可删改、不可自定义(用户决策)。
 *
 * 路径是相机轨迹。平面预设的点都在 y = center.y 上(高度由调用方取
 * 活动相机当前 Y);运镜预设带高度变化(螺旋上升/俯冲等),y 是相对
 * 落点的偏移。直线往返的"往返"由行进进度回摆实现,点列不重复。
 */
import type {Vec3Like} from './pathModel'

export type PathPreset = {
  id:
    | 'circle'
    | 'line'
    | 'arc'
    | 'figure8'
    | 'dollyIn'
    | 'reveal'
    | 'spiralUp'
    | 'crane'
    | 'orbitPush'
    | 'dive'
    | 'figure8v'
  name: string
  /** 英文运镜名(卡片副标题) */
  en: string
  /** 缩略图动画:收尾相连的路径无限绕圈,开放路径往返 */
  closed: boolean
  /** 缩略图一圈(或一个往返)的秒数 */
  durSeconds: number
}

export const PATH_PRESETS: readonly PathPreset[] = [
  {id: 'circle', name: '环绕圆', en: 'Orbit', closed: true, durSeconds: 6},
  {id: 'line', name: '直线往返', en: 'Truck', closed: false, durSeconds: 4},
  {id: 'arc', name: '弧线', en: 'Arc', closed: false, durSeconds: 5},
  {id: 'figure8', name: '8 字', en: 'Figure-8', closed: true, durSeconds: 7},
  {id: 'dollyIn', name: '推近', en: 'Dolly In', closed: false, durSeconds: 3.5},
  {id: 'reveal', name: '拉远拉升', en: 'Reveal', closed: false, durSeconds: 5},
  {
    id: 'spiralUp',
    name: '螺旋上升',
    en: 'Spiral Up',
    closed: false,
    durSeconds: 7,
  },
  {id: 'crane', name: '升降摇臂', en: 'Crane', closed: false, durSeconds: 4},
  {
    id: 'orbitPush',
    name: '环绕推近',
    en: 'Orbit Push-in',
    closed: false,
    durSeconds: 6,
  },
  {id: 'dive', name: '俯冲', en: 'Dive', closed: false, durSeconds: 4},
  {
    id: 'figure8v',
    name: '立体 8 字',
    en: 'Figure-8 Vert',
    closed: true,
    durSeconds: 8,
  },
]

const TAU = Math.PI * 2

/** 给落点返回该形状的路径点(世界坐标;y 为落点高度 + 各形状自身的偏移) */
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
    // ---- 经典运镜(带高度变化) ----
    case 'dollyIn':
      // 正对主体从远处推到近处,留 2 个身位不穿模
      return [
        {x: cx, y, z: cz + 10},
        {x: cx, y, z: cz + 2},
      ]
    case 'reveal':
      // 近低 → 远高:拉远同时爬升的揭示镜头
      return [
        {x: cx, y: y + 1, z: cz + 3},
        {x: cx, y: y + 3, z: cz + 8},
        {x: cx, y: y + 7, z: cz + 14},
      ]
    case 'spiralUp': {
      // 环绕同时爬升:1.5 圈,半径 5,升高 5
      const r = 5
      const n = 16
      const turns = 1.5
      return Array.from({length: n}, (_, i) => {
        const t = i / (n - 1)
        const a = t * turns * TAU
        return {
          x: cx + r * Math.cos(a),
          y: y + t * 5,
          z: cz + r * Math.sin(a),
        }
      })
    }
    case 'crane':
      // 摇臂:低位贴地升到高位俯瞰,带轻微前推
      return [
        {x: cx, y: y + 0.5, z: cz + 6},
        {x: cx, y: y + 3.2, z: cz + 5.5},
        {x: cx, y: y + 6, z: cz + 5},
      ]
    case 'orbitPush': {
      // 水平螺旋收缩:绕一圈,半径 7 → 2.5,边绕边靠近
      const n = 12
      return Array.from({length: n}, (_, i) => {
        const t = i / (n - 1)
        const r = 7 + (2.5 - 7) * t
        const a = t * TAU
        return {x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a)}
      })
    }
    case 'dive':
      // 高远俯冲到低近
      return [
        {x: cx, y: y + 9, z: cz + 12},
        {x: cx, y: y + 5, z: cz + 8},
        {x: cx, y: y + 2.5, z: cz + 5},
        {x: cx, y: y + 1, z: cz + 3},
      ]
    case 'figure8v': {
      // 立体 8 字:平面 8 字叠加正弦起伏,左环低右环高
      const r = 3
      const per = 6
      const pts: Vec3Like[] = []
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({
          x: cx - r + r * Math.cos(a),
          y: y + 1.2 * Math.sin(a),
          z: cz + r * Math.sin(a),
        })
      }
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU
        pts.push({
          x: cx + r - r * Math.cos(a),
          y: y + 1.2 * Math.sin(a + Math.PI / 2),
          z: cz + r * Math.sin(a),
        })
      }
      return pts
    }
  }
}

/**
 * 预设放置方案:落点写进路径的位置变换,控制点围绕局部原点生成。
 * 路径原点(整体移动箭头/原点标记的锚点)从此落在落点上;
 * 世界位置 = 位置 + 局部点,与直接以 center 调 presetPoints 完全等价
 * (放置时旋转/缩放是单位值,纯平移直接相加)。
 */
export function presetPlacement(
  preset: PathPreset,
  center: Vec3Like,
): {points: Vec3Like[]; position: Vec3Like} {
  return {
    points: presetPoints(preset, {x: 0, y: 0, z: 0}),
    position: {...center},
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
