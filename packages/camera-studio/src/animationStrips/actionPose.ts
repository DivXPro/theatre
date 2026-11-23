import type {ActionEditorSession} from '../actionEditor/session'
import {enterDraftPoseSession, getPoseSession} from '../poseMode/poseSession'
import {toBonePose} from './actionSampling'

type ActionPoseSampler = {
  applyPose: (pose: ReturnType<typeof toBonePose>) => void
  capturePose: () => {
    get: (name: string) =>
      | {
          position?: {x: number; y: number; z: number}
          quaternion?: {x: number; y: number; z: number; w: number}
          scale?: {x: number; y: number; z: number}
        }
      | undefined
  }
}

/**
 * 从动作编辑器当前局部帧进入视口摆姿。
 * 双击模型与「在视口摆姿」按钮共用这条入口，确保进入时沿用动作草稿
 * 的骨骼姿势，而不是重新按场景帧求值。
 */
export function beginActionDraftPose(
  placementKey: string,
  action: ActionEditorSession,
  sampler: ActionPoseSampler,
  invalidate: () => void,
): boolean {
  if (getPoseSession()) return true
  const actionBefore = action.getSnapshot().values.bones
  let baseline: ReturnType<ActionPoseSampler['capturePose']> | null = null
  enterDraftPoseSession(placementKey, {
    applyPreview: () => {
      sampler.applyPose(toBonePose(actionBefore))
      baseline = sampler.capturePose()
    },
    onCapture: (bones) => {
      const captured: Record<string, (typeof actionBefore)[string]> =
        Object.create(null)
      for (const [name, transform] of Object.entries(bones)) {
        const start = baseline?.get(name)
        if (!start) continue
        const {
          position: startPosition,
          quaternion: startQuaternion,
          scale: startScale,
        } = start
        if (!startPosition || !startQuaternion || !startScale) continue
        const {rotation, position} = transform
        if (!rotation && !position) continue
        const positionDelta = position
          ? Math.hypot(
              position[0] - startPosition.x,
              position[1] - startPosition.y,
              position[2] - startPosition.z,
            )
          : 0
        const rotationDelta = rotation
          ? Math.min(
              Math.hypot(
                rotation[0] - startQuaternion.x,
                rotation[1] - startQuaternion.y,
                rotation[2] - startQuaternion.z,
                rotation[3] - startQuaternion.w,
              ),
              Math.hypot(
                rotation[0] + startQuaternion.x,
                rotation[1] + startQuaternion.y,
                rotation[2] + startQuaternion.z,
                rotation[3] + startQuaternion.w,
              ),
            )
          : 0
        if (positionDelta <= 0.00001 && rotationDelta <= 0.00001) continue
        const previous = actionBefore[name]
        captured[name] = {
          position: position
            ? {x: position[0], y: position[1], z: position[2]}
            : previous?.position ?? {
                x: startPosition.x,
                y: startPosition.y,
                z: startPosition.z,
              },
          quaternion: rotation
            ? {x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3]}
            : previous?.quaternion ?? {
                x: startQuaternion.x,
                y: startQuaternion.y,
                z: startQuaternion.z,
                w: startQuaternion.w,
              },
          scale: previous?.scale ?? {
            x: startScale.x,
            y: startScale.y,
            z: startScale.z,
          },
        }
      }
      action.recordBonePose(captured)
      invalidate()
    },
    onCancel: invalidate,
  })
  return true
}
