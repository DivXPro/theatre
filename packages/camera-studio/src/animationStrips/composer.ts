import type {Quaternion, Vector3} from 'three'

export type BonePoseTransform = {
  position?: Vector3
  quaternion?: Quaternion
  scale?: Vector3
}

export type BonePose = ReadonlyMap<string, BonePoseTransform>

export type PoseSample = {
  pose: BonePose
  weight: number
  blend?: 'replace' | 'additive'
}

function cloneTransform(transform: BonePoseTransform): BonePoseTransform {
  return {
    position: transform.position?.clone(),
    quaternion: transform.quaternion?.clone(),
    scale: transform.scale?.clone(),
  }
}

function replaceTransform(
  current: BonePoseTransform | undefined,
  sample: BonePoseTransform,
  weight: number,
): BonePoseTransform {
  const result = current ? cloneTransform(current) : {}
  if (sample.position) {
    if (!result.position) {
      result.position = sample.position.clone()
    } else {
      result.position.lerp(sample.position, weight)
    }
  }
  if (sample.quaternion) {
    if (!result.quaternion) result.quaternion = sample.quaternion.clone()
    else result.quaternion.slerp(sample.quaternion, weight)
  }
  if (sample.scale) {
    if (!result.scale) result.scale = sample.scale.clone()
    else result.scale.lerp(sample.scale, weight)
  }
  return result
}

function replacePose(
  current: BonePoseTransform | undefined,
  sample: BonePoseTransform,
  weight: number,
): BonePoseTransform {
  if (weight >= 1) {
    const result = current ? cloneTransform(current) : {}
    if (sample.position) result.position = sample.position.clone()
    if (sample.quaternion) result.quaternion = sample.quaternion.clone()
    if (sample.scale) result.scale = sample.scale.clone()
    return result
  }
  return replaceTransform(current, sample, weight)
}

export function composePose(
  base: BonePose,
  samples: readonly PoseSample[],
): BonePose {
  const result = new Map<string, BonePoseTransform>(
    [...base].map(([name, transform]) => [name, cloneTransform(transform)]),
  )
  for (const sample of samples) {
    if (!Number.isFinite(sample.weight)) {
      throw new Error('Invalid animation sample weight')
    }
    if (sample.weight <= 0) continue
    if (sample.blend && sample.blend !== 'replace') {
      throw new Error(`Unsupported animation blend mode: ${sample.blend}`)
    }
    const weight = Math.min(1, sample.weight)
    for (const [name, transform] of sample.pose) {
      result.set(name, replacePose(result.get(name), transform, weight))
    }
  }
  return result
}
