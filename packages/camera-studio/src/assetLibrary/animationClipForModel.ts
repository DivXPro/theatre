import {AnimationClip, Matrix4, Vector3} from 'three'
import type {Object3D} from 'three'

export function animationClipForModel(
  gltf: {scene: Object3D; animations: AnimationClip[]},
  model: Object3D,
): AnimationClip | undefined {
  const clip = gltf.animations[0]
  const metersPerUnit =
    gltf.scene.getObjectByName('AnimationRig')?.userData.animationMetersPerUnit
  if (
    !clip ||
    typeof metersPerUnit !== 'number' ||
    !Number.isFinite(metersPerUnit) ||
    metersPerUnit <= 0
  ) {
    return clip
  }

  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.position')) return track
    const target = model.getObjectByName(
      track.name.slice(0, -'.position'.length),
    )
    if (!target) return track

    const parentToModel = new Matrix4()
    for (
      let parent = target.parent;
      parent && parent !== model.parent;
      parent = parent.parent
    ) {
      if (parent.matrixAutoUpdate) parent.updateMatrix()
      parentToModel.premultiply(parent.matrix)
    }
    const scale = new Vector3().setFromMatrixScale(parentToModel)
    if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) return track

    const converted = track.clone()
    for (let offset = 0; offset < converted.values.length; offset += 3) {
      converted.values[offset] *= metersPerUnit / scale.x
      converted.values[offset + 1] *= metersPerUnit / scale.y
      converted.values[offset + 2] *= metersPerUnit / scale.z
    }
    return converted
  })
  return new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)
}
