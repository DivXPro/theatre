import {CubicBezierCurve3, Matrix4, Vector3} from 'three'
import {buildCurve, composePathMatrix} from '../pathModel'
import type {PathPointEntry, PathTransform, Vec3Like} from '../pathModel'

export type CharacterPathForward = Pick<Vec3Like, 'x' | 'z'>

export type CharacterPathSample = {
  position: Vector3
  yaw: number | undefined
  distance: number
  totalLength: number
}

type Segment = {curve: CubicBezierCurve3; length: number; start: number}

function tangentYaw(
  curve: CubicBezierCurve3,
  parameter: number,
  forward: CharacterPathForward,
): number | undefined {
  const remaining = 1 - parameter
  const tangent = new Vector3()
    .subVectors(curve.v1, curve.v0)
    .multiplyScalar(remaining * remaining)
    .addScaledVector(
      new Vector3().subVectors(curve.v2, curve.v1),
      2 * remaining * parameter,
    )
    .addScaledVector(
      new Vector3().subVectors(curve.v3, curve.v2),
      parameter * parameter,
    )
  if (tangent.lengthSq() === 0) curve.getTangent(parameter, tangent)
  if (Math.hypot(tangent.x, tangent.z) <= tangent.length() * 1e-8) {
    return undefined
  }
  return Math.atan2(tangent.x, tangent.z) - Math.atan2(forward.x, forward.z)
}

export function buildCharacterPathSampler(
  points: readonly PathPointEntry[],
  transform: PathTransform,
) {
  const local = buildCurve(points)
  if (!local) return null
  const matrix = composePathMatrix(transform, new Matrix4())
  const segments: Segment[] = []
  let totalLength = 0
  for (const segment of local.curves as CubicBezierCurve3[]) {
    const curve = new CubicBezierCurve3(
      segment.v0.clone().applyMatrix4(matrix),
      segment.v1.clone().applyMatrix4(matrix),
      segment.v2.clone().applyMatrix4(matrix),
      segment.v3.clone().applyMatrix4(matrix),
    )
    const length = curve.getLength()
    if (!Number.isFinite(length)) return null
    if (length === 0) continue
    segments.push({curve, length, start: totalLength})
    totalLength += length
  }
  if (segments.length === 0 || !Number.isFinite(totalLength)) return null

  return {
    sample(
      progress: number,
      forward?: CharacterPathForward,
    ): CharacterPathSample {
      const fraction = Number.isFinite(progress)
        ? Math.min(100, Math.max(0, progress)) / 100
        : 0
      const distance = fraction * totalLength
      const segment =
        segments.find(({start, length}) => distance < start + length) ??
        segments[segments.length - 1]!
      const segmentDistance = Math.min(
        segment.length,
        Math.max(0, distance - segment.start),
      )
      const parameter =
        fraction === 1
          ? 1
          : segment.curve.getUtoTmapping(
              segmentDistance / segment.length,
              segmentDistance,
            )
      return {
        position: segment.curve.getPoint(parameter),
        yaw: forward
          ? tangentYaw(segment.curve, parameter, forward)
          : undefined,
        distance,
        totalLength,
      }
    },
  }
}
