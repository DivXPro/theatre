import {
  CubicBezierCurve3,
  CurvePath,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
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
  /**
   * 全程进度锚点(0~1):这个点位于运镜进度的什么位置。
   * 缺省 = 自动(弧长等比);显式设置后,行进进度走到这个值时
   * 相机正好过这个点——"把点钉到时间轴"钉的就是它(在时间轴上
   * 给行进进度打一个值=u 的关键帧)。端点恒为 0/1,不设。
   */
  u?: number
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
      // 进度锚点:只收 0~1 的有限数,坏值丢弃(回自动)
      const u =
        typeof e.u === 'number' && Number.isFinite(e.u)
          ? Math.min(1, Math.max(0, e.u))
          : undefined
      entries.push({key: e.key, position: e.position, handles, u})
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

// ---------------------------------------------------------------------------
// 路径整体变换(Blender 物体模式的对应物):路径对象带位置/旋转/缩放属性,
// 控制点存的是相对路径原点的局部坐标;世界位置 = 矩阵 × 局部。

/** 路径对象的变换属性(旋转是弧度 XYZ 欧拉,和场景里其他对象一致) */
export type PathTransform = {
  position: Vec3Like
  rotation: Vec3Like
  scale: Vec3Like
}

/** 默认变换:单位阵,局部坐标 = 世界坐标(老场景的点无缝过渡) */
export const IDENTITY_PATH_TRANSFORM: PathTransform = {
  position: {x: 0, y: 0, z: 0},
  rotation: {x: 0, y: 0, z: 0},
  scale: {x: 1, y: 1, z: 1},
}

/**
 * 组合路径的局部→世界矩阵(顺序同 three 的 Object3D:缩放→旋转→平移)。
 * 世界 = out × 局部;拖拽写回用 out 的逆矩阵(世界→局部)。
 */
export function composePathMatrix(tr: PathTransform, out: Matrix4): Matrix4 {
  return out.compose(
    new Vector3(tr.position.x, tr.position.y, tr.position.z),
    new Quaternion().setFromEuler(
      new Euler(tr.rotation.x, tr.rotation.y, tr.rotation.z, 'XYZ'),
    ),
    new Vector3(tr.scale.x, tr.scale.y, tr.scale.z),
  )
}

/**
 * 每个控制点生效的全程进度锚点(0~1,单调不减,端点恒 0/1):
 * - 没有显式 u 的点 = 自动:按弧长在前后锚点之间等比插值
 *   (一个锚点都没有时 = 全程弧长等比,和老行为数学等价)
 * - 显式 u 违反单调(比前一个锚点小)时被夹到前锚点值
 */
export function effectiveUs(
  entries: readonly PathPointEntry[],
  curve?: CurvePath<Vector3> | null,
): number[] {
  const n = entries.length
  if (n === 0) return []
  if (n === 1) return [0]
  const c = curve === undefined ? buildCurve(entries) : curve
  // 各点的弧长分数(自动锚点的插值依据)
  const fracs = new Array<number>(n).fill(0)
  if (c) {
    const lens = c.curves.map((seg) => seg.getLength())
    const total = lens.reduce((a, b) => a + b, 0)
    let acc = 0
    for (let i = 1; i < n; i++) {
      acc += lens[i - 1] ?? 0
      fracs[i] = total > 1e-9 ? acc / total : i / (n - 1)
    }
  } else {
    for (let i = 1; i < n; i++) fracs[i] = i / (n - 1)
  }
  const us = new Array<number>(n).fill(NaN)
  us[0] = 0
  us[n - 1] = 1
  // 把 (a, b] 之间还没值的自动点按弧长分数插到 [ua, ub]
  const fillSpan = (a: number, b: number, ua: number, ub: number) => {
    for (let i = a + 1; i < b; i++) {
      if (!Number.isNaN(us[i]!)) continue
      const span = fracs[b]! - fracs[a]!
      const t = span > 1e-9 ? (fracs[i]! - fracs[a]!) / span : (i - a) / (b - a)
      us[i] = ua + (ub - ua) * t
    }
  }
  let anchorIdx = 0
  let anchorU = 0
  for (let i = 1; i < n - 1; i++) {
    const explicit = entries[i]!.u
    if (explicit === undefined) continue
    const u = Math.min(1, Math.max(anchorU, clamp01(explicit)))
    fillSpan(anchorIdx, i, anchorU, u)
    us[i] = u
    anchorIdx = i
    anchorU = u
  }
  fillSpan(anchorIdx, n - 1, anchorU, 1)
  return us
}

/** 调控制点的进度锚点(夹到相邻点锚点之间,保住单调);端点恒 0/1 不可调 */
export function withMovedU(
  entries: readonly PathPointEntry[],
  key: string,
  u: number,
  curve?: CurvePath<Vector3> | null,
): PathPointEntry[] {
  const idx = entries.findIndex((e) => e.key === key)
  if (idx <= 0 || idx >= entries.length - 1) return entries.slice()
  const us = effectiveUs(entries, curve)
  const lo = us[idx - 1]! + 0.001
  const hi = us[idx + 1]! - 0.001
  const clamped = Math.min(Math.max(u, lo), Math.max(lo, hi))
  return entries.map((e, i) => (i === idx ? {...e, u: clamped} : e))
}

/** 清掉显式锚点,回到自动(弧长等比) */
export function withResetU(
  entries: readonly PathPointEntry[],
  key: string,
): PathPointEntry[] {
  return entries.map((e) => {
    if (e.key !== key || e.u === undefined) return e
    const {u: _dropped, ...rest} = e
    return rest
  })
}

/**
 * 在已构建的曲线上按进度取点。锚点分段映射:进度 p 落在哪两个点的
 * 生效锚点之间,就在那一段贝塞尔里按弧长等比取点;锚点全部自动时
 * 与全程弧长等比(旧 getPointAt)数学等价。
 */
export function sampleCurve(
  curve: CurvePath<Vector3>,
  us: readonly number[],
  p: number,
  out: Vector3Type,
): void {
  const t = clamp01(p)
  const n = us.length
  if (n < 2) return
  // t 所在段:边界恰好等于右锚点时留在左段(local=1,正好取到控制点)
  let i = 0
  while (i < n - 2 && t > us[i + 1]!) i++
  const ua = us[i]!
  const ub = us[i + 1]!
  const local = ub - ua > 1e-9 ? clamp01((t - ua) / (ub - ua)) : 0
  curve.curves[i]!.getPointAt(local, out as Vector3)
}

/**
 * 按进度在名单上取点。0 个点返回 false(调用方回退到手动驱动);
 * 1 个点时任何进度都取它(单点路径不用硬凑两个点)。
 * 每次都重建曲线,只适合一次性调用;每帧采样请 buildCurve +
 * effectiveUs 后 sampleCurve。
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
  const curve = buildCurve(entries)!
  sampleCurve(curve, effectiveUs(entries, curve), u, out)
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

/**
 * 方向箭头的放置矩阵(局部坐标,Blender 曲线方向刻度的对应物):
 * 沿曲线按弧长间距撒小箭头,每个矩阵把单位圆锥(默认朝 +Y)转到
 * 该处切线方向——箭头指向 = 行进进度 0→1 的方向。每段至少 1 个,
 * 段长按 ARROW_SPACING 加档,总数不超 maxCount(实例缓冲容量)。
 */
export const ARROW_SPACING = 1.5

export function directionArrowMatrices(
  curve: CurvePath<Vector3> | null,
  maxCount: number,
): Matrix4[] {
  if (!curve) return []
  const out: Matrix4[] = []
  const up = new Vector3(0, 1, 0)
  const pos = new Vector3()
  const tan = new Vector3()
  const one = new Vector3(1, 1, 1)
  for (const seg of curve.curves) {
    const len = seg.getLength()
    const count = Math.max(1, Math.min(8, Math.round(len / ARROW_SPACING)))
    for (let k = 0; k < count && out.length < maxCount; k++) {
      const t = (k + 0.5) / count
      seg.getPointAt(t, pos)
      seg.getTangentAt(t, tan)
      out.push(
        new Matrix4().compose(
          pos.clone(),
          new Quaternion().setFromUnitVectors(up, tan),
          one,
        ),
      )
    }
  }
  return out
}
