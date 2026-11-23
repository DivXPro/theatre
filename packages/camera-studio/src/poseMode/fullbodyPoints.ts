import {suggestBoneMap} from '@dreamerbird/threeik'
import {Vector3} from 'three'
import type {Bone, Object3D} from 'three'

type Tier = 'primary' | 'joint' | 'detail'
export type FullbodyPointSpec = {
  id: string
  bone: Bone
  tier: Tier
  group: string
  rotation: boolean
  positionEnabled: boolean
  offset?: Vector3
}

export function resolveFullbodyRig(model: Object3D, facing: Vector3) {
  const bones = new Map<string, Bone>()
  model.traverse((object) => {
    if ((object as Bone).isBone) bones.set(object.name, object as Bone)
  })
  const {map, coverage} = suggestBoneMap([...bones.keys()])
  if (coverage < 1) return null
  const bone = (profile: string) => bones.get(map.findModelBone(profile) ?? '')
  const end = (name: string) =>
    [...bones.values()].find((candidate) =>
      candidate.name.toLowerCase().endsWith(name.toLowerCase()),
    )
  const hips = bone('Hips')!
  const spine = bone('Spine')!
  const midSpine = bone('Chest') ?? spine
  const chest = bone('UpperChest') ?? midSpine
  const neck = bone('Neck')
  const head = bone('Head')!
  const hasHipsAncestor = (candidate: Object3D) => {
    for (
      let parent: Object3D | null = candidate;
      parent;
      parent = parent.parent
    ) {
      if (parent === hips) return true
    }
    return false
  }
  if (
    ![
      head,
      bone('LeftHand')!,
      bone('RightHand')!,
      bone('LeftFoot')!,
      bone('RightFoot')!,
    ].every(hasHipsAncestor)
  )
    return null

  const points: FullbodyPointSpec[] = []
  const world = (joint: Object3D) => joint.getWorldPosition(new Vector3())
  const add = (
    id: string,
    joint: Bone | undefined,
    tier: Tier,
    group: string,
    rotation: boolean,
    worldOffset?: Vector3,
  ) => {
    if (!joint || !hasHipsAncestor(joint)) return
    points.push({
      id,
      bone: joint,
      tier,
      group,
      rotation,
      positionEnabled: /^(arm|leg)[LR]$/.test(id),
      offset: worldOffset && joint.worldToLocal(worldOffset),
    })
  }

  const torsoLength = world(hips).distanceTo(world(neck ?? head))
  const crownBone = end('HeadTop_End')
  const crown = crownBone
    ? world(crownBone)
    : world(head).addScaledVector(
        world(head)
          .sub(world(neck ?? chest))
          .normalize(),
        torsoLength * 0.2,
      )
  const leftEye = bone('LeftEye')
  const rightEye = bone('RightEye')
  const headFront =
    leftEye && rightEye
      ? world(leftEye).lerp(world(rightEye), 0.5)
      : world(head).lerp(crown, 0.6)
  headFront.addScaledVector(facing, world(head).distanceTo(crown) * 0.35)

  add('hips', hips, 'primary', 'torso', true)
  add('neck', neck, 'primary', 'head', false)
  if (midSpine !== chest) add('spine', midSpine, 'joint', 'torso', false)
  else if (spine !== chest) add('spine', spine, 'joint', 'torso', false)
  add('chest', chest, 'joint', 'torso', true)
  add('head', head, 'joint', 'head', true, crown)
  add(
    'hips:front',
    hips,
    'detail',
    'torso',
    false,
    world(hips).addScaledVector(facing, torsoLength * 0.3),
  )
  add(
    'chest:front',
    chest,
    'detail',
    'torso',
    false,
    world(chest).addScaledVector(facing, torsoLength * 0.3),
  )
  add('head:front', head, 'detail', 'head', false, headFront)

  const up = new Vector3(0, 1, 0)
  for (const side of ['Left', 'Right'] as const) {
    const arm = `arm${side[0]}`
    const leg = `leg${side[0]}`
    const elbow = bone(`${side}LowerArm`)!
    const hand = bone(`${side}Hand`)!
    const knee = bone(`${side}LowerLeg`)!
    const foot = bone(`${side}Foot`)!
    const toes = bone(`${side}Toes`)
    const forearm = world(hand).sub(world(elbow))
    const shin = world(foot).sub(world(knee))
    const elbowOffset = facing
      .clone()
      .projectOnPlane(forearm)
      .normalize()
      .multiplyScalar(forearm.length() * 0.18)
    const kneeOffset = facing
      .clone()
      .projectOnPlane(shin)
      .normalize()
      .multiplyScalar(shin.length() * 0.16)
    const palm = bone(`${side}MiddleProximal`)
    const handSide = bone(`${side}LittleProximal`)

    add(arm, hand, 'primary', arm, true)
    add(`${arm}:clavicle`, bone(`${side}Shoulder`), 'joint', arm, true)
    add(`${arm}:root`, bone(`${side}UpperArm`), 'joint', arm, true)
    add(`${arm}:elbow`, elbow, 'joint', arm, true)
    add(
      `${arm}:elbow-direction`,
      elbow,
      'detail',
      arm,
      false,
      world(elbow).add(elbowOffset),
    )
    if (palm) add(`${arm}:palm`, hand, 'detail', arm, false, world(palm))
    if (handSide)
      add(`${arm}:side`, hand, 'detail', arm, false, world(handSide))
    add(leg, foot, 'primary', leg, true)
    add(`${leg}:root`, bone(`${side}UpperLeg`), 'joint', leg, true)
    add(`${leg}:elbow`, knee, 'joint', leg, true)
    add(
      `${leg}:knee-direction`,
      knee,
      'detail',
      leg,
      false,
      world(knee).add(kneeOffset),
    )
    if (toes) {
      const toeEnd = end(`${side}Toe_End`)
      const ankle = world(foot)
      const forefoot = world(toes)
      const forward = forefoot.clone().sub(ankle).projectOnPlane(up)
      const length = forward.length()
      forward.normalize()
      const outward = new Vector3()
        .crossVectors(up, forward)
        .multiplyScalar(side === 'Left' ? 1 : -1)
      const heel = ankle.addScaledVector(forward, -0.42 * length)
      heel.y = forefoot.y
      add(`${leg}:heel`, foot, 'detail', leg, false, heel)
      add(
        `${leg}:toe`,
        toes,
        'detail',
        leg,
        false,
        toeEnd
          ? world(toeEnd)
          : forefoot.clone().addScaledVector(forward, length * 0.5),
      )
      add(
        `${leg}:side`,
        foot,
        'detail',
        leg,
        false,
        forefoot.addScaledVector(outward, length * 0.35),
      )
    }
  }
  return {
    hips,
    chest,
    torso: new Set([hips, spine, midSpine, chest, neck, head]),
    points,
  }
}
