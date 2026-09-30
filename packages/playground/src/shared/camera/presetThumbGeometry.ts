/**
 * 路径预设的 SVG 缩略图几何:把预设的三维点列经 3/4 轴测投影拍成 2D,
 * 归一化进固定 viewBox,生成平滑路径。空间感三要素:地面网格、
 * 路径的地面投影(虚线影子)、主体十字。纯函数,无 DOM 依赖;
 * 逐帧采样动画在 PathPresetThumb.tsx(浏览器 only)。
 */
import type {PathPreset} from './pathPresets'
import {presetPoints} from './pathPresets'
import type {Vec3Like} from './pathModel'

export const THUMB_VW = 100
export const THUMB_VH = 64
/** 四周留白:取景锥探出路径边缘,要多留一点 */
const PAD = 12

type V2 = [number, number]

const COS30 = Math.cos(Math.PI / 6)

/** 3/4 轴测投影:y 直上,x/z 各向左右下方退 */
function project(p: Vec3Like): V2 {
  return [(p.x - p.z) * COS30, -p.y + (p.x + p.z) * 0.3]
}

/** 地面投影:压掉高度 */
function projectGround(p: Vec3Like): V2 {
  return project({x: p.x, y: 0, z: p.z})
}

/** Catmull-Rom → 三次贝塞尔;closed 时首尾环绕 */
export function smoothPath(pts: readonly V2[], closed: boolean): string {
  const n = pts.length
  if (n < 2) return ''
  if (n === 2)
    return `M ${pts[0]![0]} ${pts[0]![1]} L ${pts[1]![0].toFixed(
      1,
    )} ${pts[1]![1].toFixed(1)}`
  const get = (i: number): V2 =>
    closed ? pts[(i + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!
  let d = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1)
    const p1 = get(i)
    const p2 = get(i + 1)
    const p3 = get(i + 2)
    const c1: V2 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: V2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(
      1,
    )} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d + (closed ? ' Z' : '')
}

export type PresetThumb = {
  /** 路径本体的平滑 path d */
  d: string
  /** 有高度变化时的地面投影 path d;纯平面预设为 undefined(影子和本体重合,不画) */
  groundD?: string
  /** 地面网格(合成单条 path 的 d,M/L 段) */
  gridD: string
  /** 主体(落点)十字的中心 */
  subject: V2
}

/** 以原点为落点生成预设的缩略图几何 */
export function buildPresetThumb(preset: PathPreset): PresetThumb {
  const pts = presetPoints(preset, {x: 0, y: 0, z: 0})
  const path2 = pts.map(project)
  const ground2 = pts.map(projectGround)

  // 网格范围:包住路径地面投影和原点,向外取整扩 2
  let gx0 = 0
  let gx1 = 0
  let gz0 = 0
  let gz1 = 0
  for (const q of pts) {
    gx0 = Math.min(gx0, q.x)
    gx1 = Math.max(gx1, q.x)
    gz0 = Math.min(gz0, q.z)
    gz1 = Math.max(gz1, q.z)
  }
  gx0 = Math.floor(gx0) - 2
  gx1 = Math.ceil(gx1) + 2
  gz0 = Math.floor(gz0) - 2
  gz1 = Math.ceil(gz1) + 2
  const gridLines: Array<[V2, V2]> = []
  for (let x = gx0; x <= gx1; x += 2) {
    gridLines.push([
      projectGround({x, y: 0, z: gz0}),
      projectGround({x, y: 0, z: gz1}),
    ])
  }
  for (let z = gz0; z <= gz1; z += 2) {
    gridLines.push([
      projectGround({x: gx0, y: 0, z}),
      projectGround({x: gx1, y: 0, z}),
    ])
  }

  // 统一归一化:路径(含高度)+ 地面投影 + 网格一起进框
  const all: V2[] = [...path2, ...ground2, ...gridLines.flat()]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of all) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const s = Math.min((THUMB_VW - PAD * 2) / w, (THUMB_VH - PAD * 2) / h)
  const ox = (THUMB_VW - w * s) / 2
  const oy = (THUMB_VH - h * s) / 2
  const fit = ([x, y]: V2): V2 => [ox + (x - minX) * s, oy + (y - minY) * s]

  const pathF = path2.map(fit)
  const groundF = ground2.map(fit)
  const hasHeight = pts.some((q) => Math.abs(q.y) > 0.01)
  const gridD = gridLines
    .map(([a, b]) => {
      const [ax, ay] = fit(a)
      const [bx, by] = fit(b)
      return `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(
        1,
      )} ${by.toFixed(1)}`
    })
    .join(' ')

  return {
    d: smoothPath(pathF, preset.closed),
    groundD: hasHeight ? smoothPath(groundF, preset.closed) : undefined,
    gridD,
    subject: fit(projectGround({x: 0, y: 0, z: 0})),
  }
}
