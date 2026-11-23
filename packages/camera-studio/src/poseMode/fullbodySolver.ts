/**
 * Port of threeIK v0.2.2 playground/src/vendor/fullbody-pose-maker/ik.ts.
 * Original by k-tanaka, see LICENSE.fullbody-pose-maker.
 */
import {MathUtils, Quaternion, Vector2, Vector3} from 'three'
import type {Bone, Object3D} from 'three'

export type IKConstraint = {
  effector: Object3D
  root: Bone
  target: Vector3
  targetRot?: Quaternion
  posWeight?: number
  rotWeight?: number
}

type SolveOptions = {
  allowRootTranslation?: boolean
  lockedBones?: ReadonlySet<Bone>
  rootStep?: number
  rootClamp?: number
  comSupport?: Vector3[]
  comGain?: number
  rotGain?: number
  scale?: number
}

const EPSILON = 0.001
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

function boneChain(effector: Object3D, root: Bone): Bone[] {
  const chain: Bone[] = []
  for (let bone: Object3D | null = effector; bone; bone = bone.parent) {
    if ((bone as Bone).isBone) chain.push(bone as Bone)
    if (bone === root) return chain
  }
  return []
}

function quatLog(rotation: Quaternion): Vector3 {
  const axis = new Vector3(rotation.x, rotation.y, rotation.z)
  const length = axis.length()
  if (length < 1e-12) return axis.set(0, 0, 0)
  const sign = rotation.w < 0 ? -1 : 1
  return axis.multiplyScalar(
    (sign * 2 * Math.atan2(length, Math.abs(rotation.w))) / length,
  )
}

function boneWeight(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('hips')) return 10
  if (lower.includes('spine')) return 8
  if (/neck|head/.test(lower)) return 5
  if (/upperleg|thigh/.test(lower)) return 7
  if (/lowerleg|calf/.test(lower)) return 5
  if (/foot|toe/.test(lower)) return 2
  if (/clavicle|shoulder/.test(lower)) return 2
  if (lower.includes('upperarm')) return 4
  if (/lowerarm|forearm/.test(lower)) return 3
  return 1
}

function centerOfMass(root: Bone): Vector2 {
  const center = new Vector2()
  const world = new Vector3()
  let totalWeight = 0
  root.traverse((object) => {
    if (!(object as Bone).isBone) return
    const weight = boneWeight(object.name)
    object.getWorldPosition(world)
    center.x += world.x * weight
    center.y += world.z * weight
    totalWeight += weight
  })
  return center.divideScalar(totalWeight)
}

function cross(origin: Vector2, first: Vector2, second: Vector2): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  )
}

function convexHull(points: Vector2[]): Vector2[] {
  if (points.length <= 1) return points
  points.sort((first, second) => first.x - second.x || first.y - second.y)
  const half = (sorted: Vector2[]) => {
    const result: Vector2[] = []
    for (const point of sorted) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2], result[result.length - 1], point) <= 0
      ) {
        result.pop()
      }
      result.push(point)
    }
    result.pop()
    return result
  }
  return [...half(points), ...half(points.reverse())]
}

function closestSupport(point: Vector2, hull: Vector2[]): Vector2 {
  if (hull.length === 1) return hull[0].clone()
  if (
    hull.length > 2 &&
    hull.every(
      (start, index) =>
        cross(start, hull[(index + 1) % hull.length], point) >= 0,
    )
  ) {
    return point.clone()
  }
  let closest = hull[0].clone()
  let closestDistance = Infinity
  for (let index = 0; index < hull.length; index++) {
    const start = hull[index]
    const segment = hull[(index + 1) % hull.length].clone().sub(start)
    const position =
      point.clone().sub(start).dot(segment) / Math.max(segment.lengthSq(), 1e-9)
    const candidate = start
      .clone()
      .addScaledVector(segment, MathUtils.clamp(position, 0, 1))
    const distance = candidate.distanceToSquared(point)
    if (distance < closestDistance) {
      closestDistance = distance
      closest = candidate
    }
  }
  return closest
}

function addWorldTranslation(root: Bone, delta: Vector3): void {
  const world = root.getWorldPosition(new Vector3()).add(delta)
  root.position.copy(root.parent ? root.parent.worldToLocal(world) : world)
}

export function solveIK(
  constraints: IKConstraint[],
  iterations = 8,
  step = 0.15,
  options: SolveOptions = {},
): void {
  if (constraints.length === 0) return
  const scale = options.scale ?? 1
  const allowRootTranslation = options.allowRootTranslation ?? true
  const rootStep = options.rootStep ?? step
  const rootClamp = (options.rootClamp ?? 0.08) * scale
  const comGain = options.comGain ?? 0
  const rotGain = options.rotGain ?? 1
  const hull = convexHull(
    (options.comSupport ?? []).map(({x, z}) => new Vector2(x, z)),
  )
  const chains = constraints.map(({effector, root}) =>
    boneChain(effector, root).filter((bone) => !options.lockedBones?.has(bone)),
  )
  const roots = new Set(constraints.map(({root}) => root))
  const position = new Vector3()
  const rotation = new Quaternion()
  const sampledPosition = new Vector3()
  const sampledRotation = new Quaternion()
  const original = new Quaternion()
  const rotationStep = (step * rotGain) / EPSILON
  const positionStep = step / (EPSILON * scale * scale)

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const root of roots) root.updateWorldMatrix(true, true)
    const rotations = new Map<Bone, Vector3>()
    const translations = new Map<Bone, Vector3>()
    constraints.forEach(
      (
        {effector, root, target, targetRot, posWeight = 1, rotWeight = 0},
        index,
      ) => {
        if (posWeight > 0) effector.getWorldPosition(position)
        if (rotWeight > 0 && targetRot) effector.getWorldQuaternion(rotation)
        const positionError =
          posWeight > 0
            ? target.clone().sub(position).multiplyScalar(posWeight)
            : undefined
        const inverse = rotation.clone().invert()
        const rotationError =
          rotWeight > 0 && targetRot
            ? quatLog(targetRot.clone().multiply(inverse)).multiplyScalar(
                rotWeight,
              )
            : undefined
        const move =
          positionError && positionError.lengthSq() > 1e-10 * scale * scale
        const rotate = rotationError && rotationError.lengthSq() > 1e-10
        if (!move && !rotate) return

        for (const bone of chains[index]) {
          const delta = rotations.get(bone) ?? new Vector3()
          original.copy(bone.quaternion)
          AXES.forEach((axis, component) => {
            bone.rotateOnAxis(axis, EPSILON)
            const linear = move
              ? effector
                  .getWorldPosition(sampledPosition)
                  .sub(position)
                  .dot(positionError) * positionStep
              : 0
            const angular = rotate
              ? quatLog(
                  effector
                    .getWorldQuaternion(sampledRotation)
                    .multiply(inverse),
                ).dot(rotationError) * rotationStep
              : 0
            bone.quaternion.copy(original)
            delta.setComponent(
              component,
              delta.getComponent(component) + linear + angular,
            )
          })
          rotations.set(bone, delta)
        }
        if (move && allowRootTranslation) {
          const translation = translations.get(root) ?? new Vector3()
          translations.set(
            root,
            translation.addScaledVector(positionError, rootStep),
          )
        }
      },
    )

    if (allowRootTranslation && comGain > 0 && hull.length) {
      const root = constraints[0].root
      const center = centerOfMass(root)
      const correction = closestSupport(center, hull)
        .sub(center)
        .multiplyScalar(comGain)
      const translation = translations.get(root) ?? new Vector3()
      translations.set(
        root,
        translation.add(new Vector3(correction.x, 0, correction.y)),
      )
    }

    for (const [bone, delta] of rotations) {
      AXES.forEach((axis, component) => {
        const angle = MathUtils.clamp(delta.getComponent(component), -0.2, 0.2)
        if (Math.abs(angle) > 1e-6) bone.rotateOnAxis(axis, angle)
      })
    }
    for (const [root, translation] of translations) {
      if (translation.lengthSq() > 1e-12) {
        if (translation.length() > rootClamp) translation.setLength(rootClamp)
        addWorldTranslation(root, translation)
      }
    }
  }
  for (const root of roots) root.updateWorldMatrix(true, true)
}
