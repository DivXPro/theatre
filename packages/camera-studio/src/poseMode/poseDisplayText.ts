/**
 * 姿势属性行值区域的显示文本,纯函数便于单测(2026-10-01 与用户对齐):
 * 空值(绑定/默认)→「T 姿势」;库预设 → 预设名称(条目被删 → id +
 * 缺失标记);自定义(直接摆的,或选预设后又编辑过)→「自定义姿势」。
 */
import type {PoseEntry} from '../assetLibrary/types'
import {parsePoseValue} from './poseValue'

export function poseDisplayText(args: {
  /** 当前 pose 属性值(JSON 字符串,''=绑定/T 姿势) */
  poseJson: string
  libEntries: Pick<PoseEntry, 'id' | 'name' | 'rig'>[]
  /** 显示名解析(poseEntryName:种子条目查 i18n 词典);缺省=条目名原文 */
  nameOf?: (entry: {id: string; name: string}) => string
  t: (k: string) => string
}): string {
  const {poseJson, libEntries, nameOf, t} = args
  const value = parsePoseValue(poseJson)
  if (!value) return t('pg.pose.tPose')
  if (value.kind === 'custom') return t('pg.pose.statusCustom')
  const entry = libEntries.find((e) => e.id === value.id)
  return entry
    ? nameOf?.(entry) ?? entry.name
    : `${value.id}${t('pg.pose.libMissing')}`
}
