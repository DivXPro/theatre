/**
 * 姿势选择器选项组装(属性面板姿势区),纯函数便于单测。
 * 语义(2026-10-01 与用户对齐):预设姿势为选项、自定义保留可切回——
 * 「绑定」永远第一项;「自定义」在备份有效或当前值即自定义时出现;
 * 库预设按骨架族过滤;当前值是已删除的库条目时追加置灰缺失项如实显示。
 */
import type {PoseEntry} from '../assetLibrary/types'
import {parsePoseValue} from './poseValue'

export type PoseOptionKey = 'bind' | 'custom' | `lib:${string}`

export type PoseOption = {
  key: PoseOptionKey
  label: string
  disabled?: boolean
  hint?: string
}

export function buildPoseOptions(args: {
  /** 当前 pose 属性值(JSON 字符串,''=绑定) */
  poseJson: string
  /** poseCustom 备份属性值(自定义快照 JSON,''=无备份) */
  backupJson: string
  libEntries: Pick<PoseEntry, 'id' | 'name' | 'rig'>[]
  /** 当前选中模型的骨架族;缺省=不过滤 */
  selectedRig?: string
  t: (k: string) => string
}): {options: PoseOption[]; current: PoseOptionKey} {
  const {poseJson, backupJson, libEntries, selectedRig, t} = args
  const currentValue = parsePoseValue(poseJson)
  const current: PoseOptionKey = !currentValue
    ? 'bind'
    : currentValue.kind === 'custom'
      ? 'custom'
      : `lib:${currentValue.id}`

  const options: PoseOption[] = [{key: 'bind', label: t('pg.pose.statusBind')}]

  // 自定义选项:备份有效(可切回),或当前值就是自定义(旧工程无备份,当前得可选)
  const backupValue = parsePoseValue(backupJson)
  if (backupValue?.kind === 'custom' || currentValue?.kind === 'custom') {
    options.push({key: 'custom', label: t('pg.pose.statusCustom')})
  }

  let currentEntryMissing = false
  for (const entry of libEntries) {
    if (currentValue?.kind === 'lib' && entry.id === currentValue.id) {
      currentEntryMissing = false
    }
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
    currentEntryMissing = true
  }
  if (currentEntryMissing && currentValue?.kind === 'lib') {
    options.push({
      key: `lib:${currentValue.id}`,
      label: currentValue.id,
      disabled: true,
      hint: t('pg.pose.libMissing'),
    })
  }

  return {options, current}
}
