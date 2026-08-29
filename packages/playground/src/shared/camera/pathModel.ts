import {CubicBezierCurve3, CurvePath, Vector3} from 'three'
import type {Vector3 as Vector3Type} from 'three'

/**
 * 运镜路径的纯数据逻辑:名单 JSON 的读写、控制点命名、播种/追加、
 * 贝塞尔手柄、按进度(0~1,弧长等比)在曲线上取点。
 * 组件/按钮层只调这里,不自己碰 JSON 和曲线细节,方便单测。
 *
 * 控制点是纯数据(不是 theatre 对象):不进大纲、不上时间轴,
 * 只在视口编辑模式里显示/拖动——和 Blender 曲线同一模型。
 */

export type Vec3Like = {x: number; y: number; z: number}

/**
 * 贝塞尔手柄:相对本控制点的偏移(左=来向,右=去向)。
 * 缺省 = 自动:按相邻点算切线(等效 CatmullRom 的平滑效果);
 * 一旦拖动过就存成手动值,两个手柄方向保持共线(Blender 的"对齐")。
 */
export type HandlePair = {left: Vec3Like; right: Vec3Like}

/** 名单里的一条:position 是控制点,handles 缺省表示自动平滑 */
export type PathPointEntry = {
  key: string
  position: Vec3Like
  handles?: HandlePair
}

const isVec3 = (v: unknown): v is Vec3Like =>
  !!v &&
  typeof (v as Vec3Like).x === 'number' &&
  typeof (v as Vec3Like).y === 'number' &&
  typeof (v as Vec3Like).z === 'number'

/** 解析名单 JSON;坏数据一律当空名单,坏手柄丢弃(回到自动),不让面板里手滑输错的 JSON 崩掉画布 */
export function parsePathPoints(json: string): PathPointEntry[] {
  try {
    const list = JSON.parse(json)
    if (!Array.isArray(list)) return []
    const entries: PathPointEntry[] = []
    for (const e of list) {
      if (!e || typeof e.key !== 'string' || !isVec3(e.position)) continue
      const handles =
        e.handles && isVec3(e.handles.left) && isVec3(e.handles.right)
          ? {left: e.handles.left, right: e.handles.right}
          : undefined
      entries.push({key: e.key, position: e.position, handles})
    }
    return entries
  } catch {
    return []
  }
}

export function serializePathPoints(entries: PathPointEntry[]): string {
  return JSON.stringify(entries)
}

/** 新点命名:P<现有最大编号+1>。删过的号不复用,命名稳定好辨认 */
export function nextPointKey(entries: PathPointEntry[]): string {
  let max = 0
  for (const e of entries) {
    const m = /^P(\d+)$/.exec(e.key)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `P${max + 1}`
}

/**
 * 空路径的播种(机位路径用):从当前机位出发,绕目标点转 60° 画一段弧,
 * 中点向外鼓 30%——点一次"加点"就得到一条立即可用的环绕运镜。
 */
export function seedArcPoints(cam: Vec3Like, target: Vec3Like): Vec3Like[] {
  const p0 = new Vector3(cam.x, cam.y, cam.z)
  const t = new Vector3(target.x, target.y, target.z)
  const p2 = p0
    .clone()
    .sub(t)
    .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
    .add(t)
  const mid = p0.clone().add(p2).multiplyScalar(0.5)
  const bulge = mid.clone().sub(t).multiplyScalar(0.3)
  const p1 = mid.add(bulge)
  return [p0, p1, p2].map((p) => ({x: p.x, y: p.y, z: p.z}))
}

/** 追加点的落位:沿最后一段的方向再延伸等长一段;只有一个点时往 +x 挪 2 */
export function extendPathPoint(entries: PathPointEntry[]): Vec3Like {
  const last = entries[entries.length - 1]!.position
  if (entries.length < 2) return {x: last.x + 2, y: last.y, z: last.z}
  const prev = entries[entries.length - 2]!.position
  return {
    x: last.x + (last.x - prev.x),
    y: last.y + (last.y - prev.y),
    z: last.z + (last.z - prev.z),
  }
}

// ---------------------------------------------------------------------------
// 贝塞尔手柄

const toVec = (p: Vec3Like) => new Vector3(p.x, p.y, p.z)
// 归一化 -0:手柄取反会造出 -0,深比较/面板显示都把 -0 和 0 当两个数
const nz = (n: number) => (n === 0 ? 0 : n)
const fromVec = (v: Vector3): Vec3Like => ({x: nz(v.x), y: nz(v.y), z: nz(v.z)})

/**
 * 自动手柄:等效均匀 CatmullRom 的三次贝塞尔转换——
 * 中间点切线取前后点差分的 1/6(两侧等长共线);端点用单侧差分的 1/3,
 * 另一侧镜像(端点的"外侧"手柄不参与任何分段,只为显示对称)。
 */
export function autoHandles(
  positions: readonly Vec3Like[],
  i: number,
): HandlePair {
  const n = positions.length
  const p = toVec(positions[i]!)
  let tangent: Vector3
  if (n < 2) {
    tangent = new Vector3(1, 0, 0)
  } else if (i === 0) {
    tangent = toVec(positions[1]!)
      .sub(p)
      .multiplyScalar(1 / 3)
  } else if (i === n - 1) {
    tangent = p
      .clone()
      .sub(toVec(positions[n - 2]!))
      .multiplyScalar(1 / 3)
  } else {
    tangent = toVec(positions[i + 1]!)
      .sub(toVec(positions[i - 1]!))
      .multiplyScalar(1 / 6)
  }
  return {
    left: fromVec(tangent.clone().negate()),
    right: fromVec(tangent),
  }
}

/** 这个点当前生效的手柄:手动存了就用手动的,否则按邻居算自动的 */
export function effectiveHandles(
  entries: readonly PathPointEntry[],
  i: number,
): HandlePair {
  const entry = entries[i]!
  if (entry.handles) return entry.handles
  return autoHandles(
    entries.map((e) => e.position),
    i,
  )
}

/** 移动控制点(手柄是相对偏移,天然跟着点走) */
export function withMovedPoint(
  entries: readonly PathPointEntry[],
  key: string,
  position: Vec3Like,
): PathPointEntry[] {
  return entries.map((e) => (e.key === key ? {...e, position} : e))
}

/**
 * 拖手柄(对齐规则,同 Blender 的 Aligned):被拖的一侧取新偏移;
 * 另一侧方向镜像到与被拖侧共线、长度保持原值。原来自动的点
 * "一拖变手动":另一侧的起点长度取自动值。
 */
export function withDraggedHandle(
  entries: readonly PathPointEntry[],
  key: string,
  side: 'left' | 'right',
  newOffset: Vec3Like,
): PathPointEntry[] {
  const idx = entries.findIndex((e) => e.key === key)
  if (idx < 0) return entries.slice()
  const current = effectiveHandles(entries, idx)
  const dragged = new Vector3(newOffset.x, newOffset.y, newOffset.z)
  const draggedLen = dragged.length()
  const otherSide = side === 'left' ? 'right' : 'left'
  const otherCurrent = current[otherSide]
  const otherLen = Math.hypot(otherCurrent.x, otherCurrent.y, otherCurrent.z)
  // 拖到几乎重合时给不出方向,另一侧保持原样
  const other =
    draggedLen > 1e-6
      ? fromVec(dragged.clone().multiplyScalar(-otherLen / draggedLen))
      : otherCurrent
  const handles: HandlePair =
    side === 'left'
      ? {left: fromVec(dragged), right: other}
      : {left: other, right: fromVec(dragged)}
  return entries.map((e, i) => (i === idx ? {...e, handles} : e))
}

// ---------------------------------------------------------------------------
// 曲线构建与采样

/**
 * 把控制点折成分段三次贝塞尔曲线。不足两个点返回 null,调用方
 * 按"单点=恒定/空=回退手动"处理。每次名单变化重建一次即可,
 * 弧长缓存挂在曲线对象上,随重建自动失效。
 */
export function buildCurve(
  entries: readonly PathPointEntry[],
): CurvePath<Vector3> | null {
  if (entries.length < 2) return null
  const path = new CurvePath<Vector3>()
  for (let i = 0; i < entries.length - 1; i++) {
    const p0 = toVec(entries[i]!.position)
    const p1 = toVec(entries[i + 1]!.position)
    const h0 = effectiveHandles(entries, i)
    const h1 = effectiveHandles(entries, i + 1)
    path.add(
      new CubicBezierCurve3(
        p0,
        p0.clone().add(toVec(h0.right)),
        p1.clone().add(toVec(h1.left)),
        p1,
      ),
    )
  }
  return path
}

const clamp01 = (u: number) => Math.min(1, Math.max(0, u))

/** 在已构建的曲线上按进度取点(弧长等比:0.5 = 全长一半,速度感均匀) */
export function sampleCurve(
  curve: CurvePath<Vector3>,
  u: number,
  out: Vector3Type,
): void {
  curve.getPointAt(clamp01(u), out as Vector3)
}

/**
 * 按进度在名单上取点。0 个点返回 false(调用方回退到手动驱动);
 * 1 个点时任何进度都取它(单点路径不用硬凑两个点)。
 * 每次都重建曲线,只适合一次性调用;每帧采样请 buildCurve 后 sampleCurve。
 */
export function sampleEntries(
  entries: readonly PathPointEntry[],
  u: number,
  out: Vector3Type,
): boolean {
  if (entries.length === 0) return false
  if (entries.length === 1) {
    const p = entries[0]!.position
    out.set(p.x, p.y, p.z)
    return true
  }
  sampleCurve(buildCurve(entries)!, u, out)
  return true
}

/**
 * 把路径折线化写进 out(画路径线用),返回写入的顶点数。
 * 不足两个点时返回 0,调用方藏线。每段细分度按缓冲容量自适应:
 * 点多时每段少分几份,保证不溢出。
 */
export function buildLinePositions(
  entries: readonly PathPointEntry[],
  out: Float32Array,
): number {
  const curve = buildCurve(entries)
  if (!curve) return 0
  const maxVerts = Math.floor(out.length / 3)
  const segments = entries.length - 1
  // CurvePath.getPoints 的 divisions 是"每段"的份数,接头处去重,
  // 总顶点 = 段数 × divisions + 1;下限取 2,取大了会撑爆缓冲把线尾截断
  const divisions = Math.max(
    2,
    Math.min(64, Math.floor((maxVerts - 1) / segments)),
  )
  const sampled = curve.getPoints(divisions)
  const count = Math.min(sampled.length, maxVerts)
  for (let i = 0; i < count; i++) {
    out[i * 3] = sampled[i]!.x
    out[i * 3 + 1] = sampled[i]!.y
    out[i * 3 + 2] = sampled[i]!.z
  }
  return count
}
