import type {$IntentionalAny, FullSnapshot, Schema} from '../types'
import {isCell} from '../rogue'

const empty = {op: {}, cell: {}}

const isPlainObject = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A valid cell is either empty (`{}`, the initial state) or a rogue cell
 * (`{$type: [...], ...}`). Anything else is a raw object persisted by an
 * older, incompatible version — tolerating it would put raw entries into
 * the draft's mapProps, where the first access throws
 * "mapProps[x] is not an ahistoric cell".
 */
const isValidCell = (v: unknown): boolean =>
  isPlainObject(v) && (Object.keys(v).length === 0 || isCell(v))

export function ensureStateIsUptodate<S extends {$schemaVersion: number}>(
  original: FullSnapshot<S> | null,
  schema: Schema<S>,
): FullSnapshot<S> {
  // 旧开发版本留下的存档可能连 {op, cell} 的形状都对不上,cell 也可能是
  // 未包装的旧格式。带着这种状态启动,后续所有读写都会在深处崩掉(且报错
  // 误导),所以直接回退到空状态。
  if (
    !isPlainObject(original) ||
    !isPlainObject(original.op) ||
    !isValidCell(original.cell)
  ) {
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
