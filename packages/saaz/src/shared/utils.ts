import type {$IntentionalAny, FullSnapshot, Schema} from '../types'

const empty = {op: {}, cell: {}}

const isPlainObject = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function ensureStateIsUptodate<S extends {$schemaVersion: number}>(
  original: FullSnapshot<S> | null,
  schema: Schema<S>,
): FullSnapshot<S> {
  // 旧开发版本留下的存档可能连 {op, cell} 的形状都对不上。
  // 带着这种状态启动,后续所有读写都会在深处崩掉(且报错误导),
  // 所以直接回退到空状态。
  if (
    !isPlainObject(original) ||
    !isPlainObject(original.op) ||
    !isPlainObject(original.cell)
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
