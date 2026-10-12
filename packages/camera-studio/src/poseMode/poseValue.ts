// packages/camera-studio/src/poseMode/poseValue.ts
/**
 * 时间轴姿势属性的值模型(spec §3):pose 属性是 t.string,值为 JSON 字符串,
 * 二选一——库姿势引用 {kind:'lib',id} 或自定义骨骼快照 {kind:'custom',bones}。
 * 空串 = 无姿势(回绑定)。解析对旧两种格式容错:
 *   旧 props.pose(裸条目 id 字符串)→ lib;旧 props.poseOverride(无 kind
 *   骨骼 JSON)→ custom。读取侧因此天然向后兼容,迁移(Task 8)只搬家不改写。
 */
import type {PoseBones} from './poseOverride'

export type PosePropValue =
  | {kind: 'lib'; id: string}
  | {kind: 'custom'; bones: PoseBones}

export function serializePoseValue(v: PosePropValue): string {
  return JSON.stringify(v)
}

export function serializeLibPose(id: string): string {
  // 注:jest-esbuild 内嵌 esbuild 0.14 无 satisfies 语法,用 as 等价收紧
  return JSON.stringify({kind: 'lib', id} as PosePropValue)
}

export function serializeCustomPose(bones: PoseBones): string {
  return JSON.stringify({kind: 'custom', bones} as PosePropValue)
}

let warned = false

export function parsePoseValue(json: string): PosePropValue | null {
  const trimmed = (json ?? '').trim()
  if (!trimmed) return null
  // 旧 props.pose:裸条目 id(库条目 id 由系统生成,不以 '{' 开头)
  if (!trimmed.startsWith('{')) return {kind: 'lib', id: trimmed}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    if (!warned) {
      warned = true
      console.warn('[pose] pose 值 JSON 解析失败,回退绑定姿势')
    }
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const rec = parsed as Record<string, unknown>
  if ('kind' in rec) {
    if (rec.kind === 'lib' && typeof rec.id === 'string' && rec.id) {
      return {kind: 'lib', id: rec.id}
    }
    if (
      rec.kind === 'custom' &&
      rec.bones &&
      typeof rec.bones === 'object' &&
      !Array.isArray(rec.bones)
    ) {
      return {kind: 'custom', bones: rec.bones as PoseBones}
    }
    // kind 字段存在但无法识别:明确回 null(骨骼名不会叫 kind,无歧义)
    return null
  }
  // 旧 props.poseOverride:无 kind 的骨骼快照
  return {kind: 'custom', bones: parsed as PoseBones}
}

/** 是否已是新格式(带合法 kind 与完整负载的 JSON)——与 parsePoseValue 同严格度,缺 id/bones 不算迁移完成 */
export function isMigratedPoseValue(json: string): boolean {
  const trimmed = (json ?? '').trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false
    }
    const rec = parsed as Record<string, unknown>
    if (rec.kind === 'lib') return typeof rec.id === 'string' && !!rec.id
    if (rec.kind === 'custom') {
      return (
        !!rec.bones &&
        typeof rec.bones === 'object' &&
        !Array.isArray(rec.bones)
      )
    }
    return false
  } catch {
    return false
  }
}
