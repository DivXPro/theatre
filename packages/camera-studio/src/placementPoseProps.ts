// packages/camera-studio/src/placementPoseProps.ts
/**
 * PlacementManager 姿势属性注册的可测纯件(组件逻辑留 PlacementManager.tsx)。
 */
import {Quaternion} from 'three'
import type {Bone, Object3D} from 'three'
import {defaultT as translate} from './i18n'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {resolvePoseBones} from './poseMode/poseLibResolve'
import type {PoseBones} from './poseMode/poseOverride'
import {parsePoseValue} from './poseMode/poseValue'

const MIXAMO_HIPS = 'mixamorigHips'

/** 库条目使用计数:姿势值(新旧格式通吃)是否引用了该条目 */
export function isPoseEntryUsed(poseJson: string, entryId: string): boolean {
  const v = parsePoseValue(poseJson)
  return v?.kind === 'lib' && v.id === entryId
}

function createPlacementPoseResolver(model: Object3D): typeof resolvePoseBones {
  const hips = model.getObjectByName(MIXAMO_HIPS) as Bone | undefined
  if (!hips?.isBone) return resolvePoseBones

  const targetParentInPlacementSpace = new Quaternion()
  for (
    let ancestor = hips.parent;
    ancestor && ancestor !== model.parent;
    ancestor = ancestor.parent
  ) {
    targetParentInPlacementSpace.premultiply(ancestor.quaternion)
  }
  if (targetParentInPlacementSpace.equals(new Quaternion())) {
    return resolvePoseBones
  }

  const yBotToTargetParent = targetParentInPlacementSpace.normalize().invert()
  const convertedPoses = new WeakMap<PoseBones, PoseBones>()
  return (value) => {
    const bones = resolvePoseBones(value)
    if (!bones || value?.kind !== 'lib' || !value.id.startsWith('seed-pose-')) {
      return bones
    }
    const presetHips = bones[MIXAMO_HIPS]
    if (!presetHips?.rotation) return bones

    const cached = convertedPoses.get(bones)
    if (cached) return cached
    const rotation = new Quaternion()
      .fromArray(presetHips.rotation)
      .premultiply(yBotToTargetParent)
      .normalize()
    const converted: PoseBones = {
      ...bones,
      [MIXAMO_HIPS]: {
        ...presetHips,
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      },
    }
    convertedPoses.set(bones, converted)
    return converted
  }
}

/** pose 属性的注册形态(spec §6.1 + 2026-10-01 属性行化):值是 JSON 字符串。
 *  模型属性面板隐藏这行，场景姿势只在时间轴轨道/关键帧弹框中编辑；值区域由
 *  注册表里的 pose 编辑器渲染(显示 T 姿势/预设名/自定义姿势)。自定义插值器
 *  让轨道帧间平滑混合。 */
export function posePropConfigShape(model?: Object3D): {
  defaultValue: string
  resolveBones: typeof resolvePoseBones
  opts: {
    hidden: boolean
    label: () => string
    editor: string
    interpolate: typeof poseInterpolate
  }
} {
  const resolveBones = model
    ? createPlacementPoseResolver(model)
    : resolvePoseBones
  return {
    defaultValue: '',
    resolveBones,
    opts: {
      hidden: true,
      label: () => translate('pg.props.pose'),
      editor: 'pose',
      interpolate:
        resolveBones === resolvePoseBones
          ? poseInterpolate
          : (left, right, progression) =>
              poseInterpolate(left, right, progression, resolveBones),
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

/**
 * 空闲(非播放)时是否把姿势值应用到骨骼:
 * - 播放中不应用(mixer/播放求值独占骨骼);
 * - 姿势模式会话中不应用——骨骼归 IK 骨架每帧重解算,applyPose 会被当帧
 *   压回,抢了也白抢。会话期间值被弹框/撤销/同步改掉时,靠会话退出后
 *   effect 依赖(poseModeActive)重跑把当前值补刷回骨骼,修「Esc 后模型
 *   停在旧姿势、再点同值不生效」的脱节卡死。
 */
export function shouldApplyPoseWhenIdle(
  playing: boolean,
  poseModeActive: boolean,
): boolean {
  return !playing && !poseModeActive
}
