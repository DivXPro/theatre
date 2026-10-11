// packages/playground/src/shared/camera/poseMode/poseMigration.ts
/**
 * 旧两字段(props.pose 裸 id / props.poseOverride 骨骼 JSON)迁移为新 pose
 * 值(spec §9)。覆盖优先;新值已存在不碰;旧值原样搬——读取侧
 * parsePoseValue 把旧格式容错成新形态,搬家即升级。
 */
import {isMigratedPoseValue} from './poseValue'

export function computeLegacyPoseMigration(legacy: {
  pose: string
  poseOverride: string
}): string | null {
  if (isMigratedPoseValue(legacy.pose)) return null
  if (legacy.poseOverride.trim()) return legacy.poseOverride
  if (legacy.pose.trim()) return legacy.pose
  return null
}
