import {Matrix3, Matrix4, PropertyBinding, Vector3} from 'three'
import type {AnimationClip, KeyframeTrack, Object3D} from 'three'

type PositionTrack = KeyframeTrack & {
  createInterpolant(result: Float32Array): {
    evaluate(time: number): ArrayLike<number>
  }
}

export function hasRootTravel(
  model: Object3D,
  clip: AnimationClip,
  from = 0,
  to = clip.duration,
): boolean {
  const roots = new Set<Object3D>([model])
  model.traverse((node) => {
    const isBone = (node as Object3D & {isBone?: boolean}).isBone === true
    const parentIsBone =
      (node.parent as (Object3D & {isBone?: boolean}) | null)?.isBone === true
    if (!isBone || parentIsBone) return
    for (
      let ancestor: Object3D | null = node;
      ancestor && ancestor !== model;
      ancestor = ancestor.parent
    ) {
      roots.add(ancestor)
    }
  })
  model.updateWorldMatrix(true, true)
  const inverseModel = model.matrixWorld.clone().invert()
  const displacement = new Vector3()

  return clip.tracks.some((track) => {
    const binding = PropertyBinding.parseTrackName(track.name)
    if (
      binding.propertyName !== 'position' ||
      binding.objectName ||
      binding.propertyIndex !== undefined
    )
      return false
    const target = PropertyBinding.findNode(
      model,
      binding.nodeName,
    ) as Object3D | null
    if (!target || !roots.has(target)) return false

    const interpolant = (track as PositionTrack).createInterpolant(
      new Float32Array(3),
    )
    const start = new Vector3().fromArray(interpolant.evaluate(from))
    displacement.fromArray(interpolant.evaluate(to)).sub(start)
    if (target !== model && target.parent) {
      const parentToModel = new Matrix4().multiplyMatrices(
        inverseModel,
        target.parent.matrixWorld,
      )
      displacement.applyMatrix3(new Matrix3().setFromMatrix4(parentToModel))
    }
    return Math.hypot(displacement.x, displacement.z) >= 0.001
  })
}
