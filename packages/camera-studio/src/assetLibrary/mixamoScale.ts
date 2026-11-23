import {Box3} from 'three'
import type {Object3D} from 'three'
import {modelScaleConfig} from './modelScaleConfig'
import {collectBoneNames} from './rig'

const MIXAMO_LANDMARK_NAME =
  /^mixamorig[:_]?\d*[:_]?(hips|head|leftfoot|rightfoot)(?:_\d+)?$/i

export function measureMixamoCalibration(root: Object3D) {
  const landmarks = new Set<string>()
  for (const name of collectBoneNames(root)) {
    const match = MIXAMO_LANDMARK_NAME.exec(name)
    if (match) landmarks.add(match[1].toLowerCase())
  }
  if (landmarks.size !== 4) return undefined

  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root, true)
  const height = bounds.max.y - bounds.min.y
  if (!Number.isFinite(height) || height <= 0) return undefined

  return {
    scale: modelScaleConfig.mixamoHeightMeters / height,
    lift: root.position.y - bounds.min.y,
  }
}
