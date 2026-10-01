/**
 * 姿势选择弹框的选项组装(属性面板姿势行),纯函数便于单测。
 * 语义(2026-10-01 与用户对齐):弹框 = 纯姿势列表——「T 姿势」
 * (绑定/默认)永远第一项,往下是库预设(骨架族过滤置灰);自定义
 * 姿势不是弹框选项,只能双击模型进姿势模式编辑产生,但 current
 * 会如实报 'custom'(列表里无对应高亮项)。当前值引用已删除的
 * 库条目时追加置灰缺失项如实显示。
 */
import type {PoseEntry} from '../assetLibrary/types'
import {parsePoseValue} from './poseValue'

export type PoseOptionKey = 'bind' | `lib:${string}`
/** 当前状态:custom 没有对应弹框选项,仅作状态上报 */
export type PoseCurrentKey = PoseOptionKey | 'custom'

export type PoseOption = {
  key: PoseOptionKey
  label: string
  disabled?: boolean
  hint?: string
}

export function buildPoseOptions(args: {
  /** 当前 pose 属性值(JSON 字符串,''=绑定/T 姿势) */
  poseJson: string
  libEntries: Pick<PoseEntry, 'id' | 'name' | 'rig'>[]
  /** 当前选中模型的骨架族;缺省=不过滤 */
  selectedRig?: string
  t: (k: string) => string
}): {options: PoseOption[]; current: PoseCurrentKey} {
  const {poseJson, libEntries, selectedRig, t} = args
  const currentValue = parsePoseValue(poseJson)
  const current: PoseCurrentKey = !currentValue
    ? 'bind'
    : currentValue.kind === 'custom'
      ? 'custom'
      : `lib:${currentValue.id}`

  const options: PoseOption[] = [{key: 'bind', label: t('pg.pose.tPose')}]

  for (const entry of libEntries) {
    const rigMismatch = selectedRig !== undefined && entry.rig !== selectedRig
    options.push({
      key: `lib:${entry.id}`,
      label: entry.name,
      disabled: rigMismatch || undefined,
      hint: rigMismatch ? t('pg.lib.rigMismatch') : undefined,
    })
  }
  // 当前值引用的库条目已不在库里(被删/多端缺条目):追加置灰缺失项
  if (
    currentValue?.kind === 'lib' &&
    !libEntries.some((e) => e.id === currentValue.id)
  ) {
    options.push({
      key: `lib:${currentValue.id}`,
      label: currentValue.id,
      disabled: true,
      hint: t('pg.pose.libMissing'),
    })
  }

  return {options, current}
}
