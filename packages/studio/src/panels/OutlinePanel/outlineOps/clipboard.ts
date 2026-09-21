import {val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import type {$FixMe} from '@dreamerbird/core/types/public'
import type {SerializableValue} from '@dreamerbird/core/types/public'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'
import {fingerprintOfConfig} from './fingerprint'

/**
 * 对象剪贴板:会话内有效的对象快照(静态值 + 模板结构指纹)。
 * 粘贴以指纹把关——只有同构模板的对象才允许粘贴(spec §2)。
 */
export type ObjectSnapshot = {
  fingerprint: string
  values: Record<string, SerializableValue>
}

let clipboard: ObjectSnapshot | undefined

export function snapshotSheetObject(obj: SheetObject): ObjectSnapshot {
  const props = obj.template.staticConfig.props
  const values: Record<string, SerializableValue> = {}
  for (const key of Object.keys(props)) {
    const v = val((obj as $FixMe).props[key])
    // 快照要脱开引用,JSON 克隆即可(值均为 SerializableValue)
    values[key] = JSON.parse(JSON.stringify(v))
  }
  return {fingerprint: fingerprintOfConfig(obj.template.staticConfig), values}
}

export function readObjectClipboard(): ObjectSnapshot | undefined {
  return clipboard
}

export function copySheetObject(obj: SheetObject): void {
  clipboard = snapshotSheetObject(obj)
}

export function canPasteSnapshot(
  target: SheetObject,
  snap?: ObjectSnapshot,
): boolean {
  // 省略第二参才回落到模块剪贴板;显式传 undefined 表示"无快照",禁粘
  const effective = arguments.length < 2 ? clipboard : snap
  if (!effective) return false
  return (
    effective.fingerprint === fingerprintOfConfig(target.template.staticConfig)
  )
}

/** 纯写入逻辑:test 注入 setProp 收集调用;生产传事务 api 的 set */
export function pasteSnapshot(
  setProp: (pointer: Pointer<$FixMe>, value: $FixMe) => void,
  target: SheetObject,
  snap: ObjectSnapshot,
): void {
  for (const [key, value] of Object.entries(snap.values)) {
    setProp((target as $FixMe).props[key] as Pointer<$FixMe>, value)
  }
}

/** 事务内整体写入;指纹不匹配返回 false 不做事 */
export function pasteSheetObject(target: SheetObject): boolean {
  if (!canPasteSnapshot(target)) return false
  const snap = clipboard!
  getStudio().transaction(({set}) => {
    pasteSnapshot(set, target, snap)
  })
  return true
}
