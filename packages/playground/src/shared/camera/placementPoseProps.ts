// packages/playground/src/shared/camera/placementPoseProps.ts
/**
 * PlacementManager 姿势属性注册的可测纯件(组件逻辑留 PlacementManager.tsx)。
 */
import {defaultT as translate} from './i18n'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {parsePoseValue} from './poseMode/poseValue'

/** 库条目使用计数:姿势值(新旧格式通吃)是否引用了该条目 */
export function isPoseEntryUsed(poseJson: string, entryId: string): boolean {
  const v = parsePoseValue(poseJson)
  return v?.kind === 'lib' && v.id === entryId
}

/** pose 属性的注册形态(spec §6.1):值是 JSON 字符串,面板隐藏,自定义插值 */
export function posePropConfigShape(): {
  defaultValue: string
  opts: {
    label: () => string
    hidden: boolean
    interpolate: typeof poseInterpolate
  }
} {
  return {
    defaultValue: '',
    opts: {
      label: () => translate('pg.props.pose'),
      hidden: true,
      interpolate: poseInterpolate,
    },
  }
}

/**
 * 播放中是否逐帧应用求值姿势(spec §7.1):有轨道才应用——姿势对快照内含的
 * 骨骼逐骨压过动作片段;无轨道保持现状(mixer 独占,停止时一次性回放)。
 */
export function shouldApplyPoseDuringPlayback(hasPoseTrack: boolean): boolean {
  return hasPoseTrack
}
