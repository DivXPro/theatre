import {Euler, PropertyBinding, Quaternion, Vector3} from 'three'
import type {AnimationClip, Object3D} from 'three'
import {sampleActionEditorChannels} from '../actionEditor/keys'
import type {
  ActionEditorBoneTransform,
  ActionEditorObjectValues,
  ActionEditorXYZ,
} from '../actionEditor/keys'
import type {BonePose, BonePoseTransform} from './composer'
import {editableActionFor, evaluateStrips, findAnimationStrip} from './model'
import type {AnimationTrackState} from './model'

const zero = {x: 0, y: 0, z: 0}
const one = {x: 1, y: 1, z: 1}
const identity = {...zero, w: 1}

export type RootTransformProps = {
  position?: ActionEditorXYZ
  rotation?: ActionEditorXYZ
  scale?: ActionEditorXYZ
}

export function readRootTransform(
  values: RootTransformProps,
): ActionEditorObjectValues {
  const rotation = values.rotation ?? zero
  const {x, y, z, w} = new Quaternion().setFromEuler(
    new Euler(rotation.x, rotation.y, rotation.z),
  )
  return {
    position: values.position ?? zero,
    quaternion: {x, y, z, w},
    scale: values.scale ?? one,
  }
}

export function applyRootTransform(
  target: Object3D,
  values: ActionEditorObjectValues,
): void {
  const {position, quaternion, scale} = values
  if (position) target.position.set(position.x, position.y, position.z)
  if (quaternion)
    target.quaternion.set(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    )
  if (scale) target.scale.set(scale.x, scale.y, scale.z)
}

export function sampleObjectActions(
  state: AnimationTrackState,
  sceneTimeMs: number,
): ActionEditorObjectValues | undefined {
  if (state.kind !== 'tracks') return
  const {document} = state
  let result: ActionEditorObjectValues | undefined
  for (const contribution of evaluateStrips(document, sceneTimeMs)) {
    const found = findAnimationStrip(document, contribution.stripId)
    if (found?.track.kind !== 'object') continue
    const action = editableActionFor(document, found.strip)
    if (!action?.channels.length) continue
    result = {
      ...result,
      ...sampleActionEditorChannels(action.channels, contribution.sourceTimeMs)
        .object,
    }
  }
  return result
}

export function toBonePose(
  values: Readonly<Partial<Record<string, ActionEditorBoneTransform>>>,
): BonePose {
  const pose = new Map<string, BonePoseTransform>()
  for (const [name, transform] of Object.entries(values)) {
    if (!transform) continue
    const {position, quaternion, scale} = transform
    pose.set(name, {
      position: new Vector3(position.x, position.y, position.z),
      quaternion: new Quaternion(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      ),
      scale: new Vector3(scale.x, scale.y, scale.z),
    })
  }
  return pose
}

export function readBoneTransform(
  transform: BonePoseTransform | undefined,
): ActionEditorBoneTransform {
  const position = transform?.position ?? zero
  const quaternion = transform?.quaternion ?? identity
  const scale = transform?.scale ?? one
  return {
    position: {x: position.x, y: position.y, z: position.z},
    quaternion: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
    scale: {x: scale.x, y: scale.y, z: scale.z},
  }
}

export function sourceBoneKeyTimes(
  clip: AnimationClip,
  boneName: string,
): number[] {
  const times = new Set<number>()
  for (const track of clip.tracks) {
    const binding = PropertyBinding.parseTrackName(track.name)
    if (binding.nodeName !== boneName) continue
    if (
      binding.propertyName === 'position' ||
      binding.propertyName === 'quaternion' ||
      binding.propertyName === 'scale'
    ) {
      for (const time of track.times) times.add(time * 1000)
    }
  }
  return [...times].sort((left, right) => left - right)
}
