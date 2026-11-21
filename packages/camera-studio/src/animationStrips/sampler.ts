import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  LoopOnce,
  PropertyBinding,
} from 'three'
import type {Object3D} from 'three'
import {composePose} from './composer'
import type {BonePose, BonePoseTransform, PoseSample} from './composer'
import {evaluateStrips} from './model'
import type {AnimationTrackState} from './model'

type PoseChannel = 'position' | 'quaternion' | 'scale'

export function applyAnimationStripFrame(
  sampler: ReturnType<typeof createStripSampler>,
  state: AnimationTrackState,
  clipFor: (assetId: string) => AnimationClip | undefined,
  timeMs: number,
  applyBase: () => void,
): void {
  sampler.resetBase()
  applyBase()
  if (state.kind !== 'tracks') return
  const base = sampler.capturePose()
  const samples: PoseSample[] = []
  for (const contribution of evaluateStrips(state.document, timeMs)) {
    const clip = clipFor(contribution.assetId)
    if (!clip) continue
    samples.push({
      pose: sampler.sample(clip, contribution.sourceTimeMs / 1000),
      weight: contribution.weight,
      blend: 'replace',
    })
  }
  sampler.applyPose(composePose(base, samples))
}

export function createStripSampler(model: Object3D) {
  const samples = new Group()
  const bones = new Map<string, {target: Bone; source: Bone}>()
  const base: Array<() => void> = []
  model.traverse((node) => {
    if (!(node as Bone).isBone) return
    const target = node as Bone
    const source = new Bone()
    source.name = target.name
    source.position.copy(target.position)
    source.quaternion.copy(target.quaternion)
    source.scale.copy(target.scale)
    samples.add(source)
    if (!bones.has(target.name)) bones.set(target.name, {target, source})
    const position = target.position.clone()
    const quaternion = target.quaternion.clone()
    const scale = target.scale.clone()
    base.push(() => {
      target.position.copy(position)
      target.quaternion.copy(quaternion)
      target.scale.copy(scale)
    })
  })
  const mixer = new AnimationMixer(samples)
  function bindClip(clip: AnimationClip) {
    const channels: Array<{boneName: string; property: PoseChannel}> = []
    const tracks = clip.tracks.filter((track) => {
      const path = PropertyBinding.parseTrackName(track.name)
      const bone = bones.get(path.nodeName)
      if (!bone || path.objectName || path.propertyIndex !== undefined)
        return false
      switch (path.propertyName) {
        case 'position':
        case 'quaternion':
        case 'scale':
          channels.push({boneName: path.nodeName, property: path.propertyName})
          return true
        default:
          return false
      }
    })
    if (!tracks.length)
      throw new Error('Animation has no channels for this skeleton')
    const filtered = new AnimationClip(clip.name, clip.duration, tracks)
    const action = mixer.clipAction(filtered).setLoop(LoopOnce, 1)
    return {action, channels}
  }
  const bound = new Map<AnimationClip, ReturnType<typeof bindClip>>()
  let active: ReturnType<typeof bindClip> | undefined

  function prepare(clip: AnimationClip): ReturnType<typeof bindClip> {
    const existing = bound.get(clip)
    if (existing) return existing
    const result = bindClip(clip)
    bound.set(clip, result)
    return result
  }

  function activate(next: ReturnType<typeof bindClip>) {
    if (next === active) return
    active?.action.stop()
    next.action.reset().play()
    next.action.paused = true
    active = next
  }

  function sample(clip: AnimationClip, sourceTime: number): BonePose {
    const next = prepare(clip)
    activate(next)
    next.action.time = sourceTime
    mixer.update(0)
    const pose = new Map<string, BonePoseTransform>()
    for (const {boneName, property} of next.channels) {
      const bone = bones.get(boneName)
      if (!bone) continue
      let transform = pose.get(boneName)
      if (!transform) {
        transform = {}
        pose.set(boneName, transform)
      }
      switch (property) {
        case 'position':
          transform.position = bone.source.position.clone()
          break
        case 'quaternion':
          transform.quaternion = bone.source.quaternion.clone()
          break
        case 'scale':
          transform.scale = bone.source.scale.clone()
          break
      }
    }
    return pose
  }

  function capturePose(): BonePose {
    const pose = new Map<string, BonePoseTransform>()
    for (const [name, {target}] of bones) {
      pose.set(name, {
        position: target.position.clone(),
        quaternion: target.quaternion.clone(),
        scale: target.scale.clone(),
      })
    }
    return pose
  }

  function applyPose(pose: BonePose): void {
    for (const [name, transform] of pose) {
      const bone = bones.get(name)
      if (!bone) continue
      if (transform.position) bone.target.position.copy(transform.position)
      if (transform.quaternion) {
        bone.target.quaternion.copy(transform.quaternion)
      }
      if (transform.scale) bone.target.scale.copy(transform.scale)
    }
  }

  return {
    hasBones: bones.size > 0,
    prepare,
    sample,
    capturePose,
    applyPose,
    resetBase() {
      for (const reset of base) reset()
    },
    apply(clip: AnimationClip, sourceTime: number) {
      applyPose(sample(clip, sourceTime))
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(samples)
      bound.clear()
      active = undefined
    },
  }
}
