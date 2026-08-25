import type {$IntentionalAny, FullSnapshot, Schema} from '../types'
import {isCell} from '../rogue'

const empty = {op: {}, cell: {}}

const isPlainObject = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A valid cell is either empty (`{}`, the initial state) or a rogue cell
 * (`{$type: [...], ...}`) whose mapProps recursively contain only cells.
 * Anything else is a raw or mixed-format tree persisted by an older,
 * incompatible version — tolerating it would leave raw entries in the
 * draft's mapProps, where the first access throws
 * "mapProps[x] is not an ahistoric cell".
 */
const isValidCell = (v: unknown): boolean =>
  isPlainObject(v) && (Object.keys(v).length === 0 || isValidCellDeep(v))

const isValidCellDeep = (v: unknown): boolean => {
  if (!isCell(v)) return false
  if (v.$type[0] !== 'map') return true
  const branches = v.$branches
  if (branches === undefined) return true
  if (!isPlainObject(branches)) return false
  for (const branch of Object.values(branches)) {
    const mapProps = (branch as $IntentionalAny)?.$mapProps
    if (mapProps === undefined) continue
    if (!isPlainObject(mapProps)) return false
    for (const sub of Object.values(mapProps)) {
      if (!isValidCellDeep(sub)) return false
    }
  }
  return true
}

export function ensureStateIsUptodate<S extends {$schemaVersion: number}>(
  original: FullSnapshot<S> | null,
  schema: Schema<S>,
): FullSnapshot<S> {
  // 旧开发版本留下的存档可能连 {op, cell} 的形状都对不上,cell 也可能是
  // 未包装的旧格式或新旧混合树。带着这种状态启动,后续所有读写都会在深处
  // 崩掉(且报错误导),所以直接回退到空状态。
  if (original === null) {
    return empty as $IntentionalAny
  }
  if (
    !isPlainObject(original) ||
    !isPlainObject(original.op) ||
    !isValidCell(original.cell)
  ) {
    console.warn(
      '[saaz] dropping an incompatible persisted snapshot and starting ' +
        'from an empty state (it was likely written by an older version)',
    )
    return empty as $IntentionalAny
  }
  return original as $IntentionalAny

  // if (
  //   !original ||
  //   typeof original.op.$schemaVersion !== 'number' ||
  //   original.op.$schemaVersion < schema.version
  // ) {
  //   return {
  //     op: produce((original?.op ?? {}) as {}, (originalDraft) => {
  //       schema.migrateOp(originalDraft)
  //     }) as S,
  //     cell: original?.cell ?? {},
  //   }
  // } else {
  //   return original
  // }
}
