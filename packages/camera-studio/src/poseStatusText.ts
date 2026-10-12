// packages/camera-studio/src/poseStatusText.ts
/** 姿势状态行文案推导(spec §6.2),纯函数便于单测 */
import {parsePoseValue} from './poseMode/poseValue'

export function poseStatusText(
  poseJson: string,
  libName: string | null,
  t: (k: string) => string,
): string {
  const v = parsePoseValue(poseJson)
  if (!v) return t('pg.pose.statusBind')
  if (v.kind === 'custom') return t('pg.pose.statusCustom')
  return `${t('pg.pose.statusLibPrefix')}${libName ?? v.id}`
}
