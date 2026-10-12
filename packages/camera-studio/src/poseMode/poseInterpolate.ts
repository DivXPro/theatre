// packages/camera-studio/src/poseMode/poseInterpolate.ts
/**
 * 姿势属性的自定义插值器(spec §4),注入 t.string 的 opts.interpolate。
 * theatre 求值契约:(left, right, progression) => value,progression 已过
 * 贝塞尔手柄缓动。语义:
 *   两侧都解析出骨骼 → 逐骨骼 slerp/lerp,结果恒为 custom 快照——
 *     两帧之间的求值产物天然可被 applyPose 直接回放;
 *   任一侧为空/非法/库引用未解析 → 阶跃,原样返回 left(与 theatre 缺省
 *     leftInterpolate 行为一致,可预测)。
 * 性能:parse 按字符串值小容量 LRU;拖针/播放时帧值不变全部命中。
 */
import {Quaternion, Vector3} from 'three'
import type {PoseBones} from './poseOverride'
import {resolvePoseBones} from './poseLibResolve'
import {parsePoseValue, serializeCustomPose} from './poseValue'
import type {PosePropValue} from './poseValue'

const PARSE_CACHE_LIMIT = 64
const parseCache = new Map<string, PosePropValue | null>()
// PoseEntry 骨骼字段可缺省,插值缺侧补单位旋转/零位移
const IDENTITY_ROT: [number, number, number, number] = [0, 0, 0, 1]
const ZERO_POS: [number, number, number] = [0, 0, 0]

function parseCached(json: string): PosePropValue | null {
  const hit = parseCache.get(json)
  if (hit !== undefined || parseCache.has(json)) return hit ?? null
  const v = parsePoseValue(json)
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value!)
  }
  parseCache.set(json, v)
  return v
}

export function mixPoseBones(a: PoseBones, b: PoseBones, t: number): PoseBones {
  // 端点短路(跳过逐骨骼数学):共享骨骼取端点侧,只在一侧有的骨骼仍要
  // 保留——否则 t=0 时右帧独有骨骼会凭空消失
  if (t === 0) return {...b, ...a}
  if (t === 1) return {...a, ...b}
  const out: PoseBones = {}
  const qa = new Quaternion()
  const qb = new Quaternion()
  const va = new Vector3()
  const vb = new Vector3()
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ba = a[name]
    const bb = b[name]
    // 只在一侧有的骨骼全程取有数据侧(不淡入淡出,避免半姿势)
    if (ba && !bb) {
      out[name] = ba
      continue
    }
    if (!ba && bb) {
      out[name] = bb
      continue
    }
    // 类型上 rotation/position 均可缺省(见 PoseEntry),缺失按单位旋转/零位移补
    qa.fromArray(ba!.rotation ?? IDENTITY_ROT)
    qb.fromArray(bb!.rotation ?? IDENTITY_ROT)
    qa.slerp(qb, t)
    va.fromArray(ba!.position ?? ZERO_POS)
    vb.fromArray(bb!.position ?? ZERO_POS)
    va.lerp(vb, t)
    out[name] = {
      rotation: [qa.x, qa.y, qa.z, qa.w],
      position: [va.x, va.y, va.z],
    }
  }
  return out
}

export function poseInterpolate(
  leftJson: string,
  rightJson: string,
  progression: number,
): string {
  const lb = resolvePoseBones(parseCached(leftJson))
  const rb = resolvePoseBones(parseCached(rightJson))
  if (!lb || !rb) return leftJson
  return serializeCustomPose(mixPoseBones(lb, rb, progression))
}
