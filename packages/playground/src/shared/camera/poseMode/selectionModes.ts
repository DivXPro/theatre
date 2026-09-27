// packages/playground/src/shared/camera/poseMode/selectionModes.ts
/**
 * 控制点选中目标 → 支持的操纵器模式。
 * 用途:浮动小条禁用不可用模式按钮;选中单模式点时自动切到可用模式。
 * 语义对齐 threeik 0.1.0 装配器的 attach 路由(skeleton-controls):
 * 纯旋转目标(bone、limb 的肩/髋根环)在 move 模式下也出环——
 * 按钮不禁用的话高亮会停在语义不符的「移动」上。
 */
import type {ControlPointSpec} from '@dreamerbird/threeik/controls'
import type {PoseManipulatorMode, PoseModeSupport} from './poseSession'

export type {PoseModeSupport} from './poseSession'

const BOTH: PoseModeSupport = {move: true, rotate: true}

export function supportedModesForSelection(
  specs: ControlPointSpec[],
  selected: string | null,
): PoseModeSupport {
  if (!selected) return BOTH
  const colon = selected.indexOf(':')
  const name = colon === -1 ? selected : selected.slice(0, colon)
  const sub = colon === -1 ? null : selected.slice(colon + 1)
  const spec = specs.find((s) => s.name === name)
  if (!spec) return BOTH
  // 子选中:limb 的肩/髋根环(sub=root,rotationOnly)纯旋转;
  // elbow 双通道(move 拖 pole 球 / rotate 出肘环)
  if (sub !== null) {
    if (spec.kind === 'limb' && sub === 'root') {
      return {move: false, rotate: true}
    }
    return BOTH
  }
  switch (spec.kind) {
    case 'bone':
      return {move: false, rotate: true}
    case 'chain':
      return {move: true, rotate: false}
    case 'lookAt': {
      // ControlPointSpec 联合带自定义 kind 兜底成员,kind 判别窄不到
      // LookAtControlSpec;用 in 双窄化(类型+运行时),不用 as
      const share = 'rotateShare' in spec ? spec.rotateShare : undefined
      return share ? BOTH : {move: true, rotate: false}
    }
    default:
      return BOTH
  }
}

/** 当前模式在支持集里不可用 → 返回应切到的可用模式;可用/无需切 → null */
export function resolvePoseModeSwitch(
  support: PoseModeSupport,
  current: PoseManipulatorMode,
): PoseManipulatorMode | null {
  if (support[current]) return null
  return support.move ? 'move' : 'rotate'
}
