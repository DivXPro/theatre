import {Bone, Group, Quaternion, Vector3} from 'three'
import {applyPose, capturePose} from '../assetLibrary/pose'
import {resolveFullbodyRig} from './fullbodyPoints'
import {solveIK} from './fullbodySolver'
import {parsePoseValue, serializeCustomPose} from './poseValue'

function humanoid(scale = 1) {
  const model = new Group()
  model.position.set(3, 0, -2)
  model.rotation.y = 0.4
  model.scale.setScalar(scale)
  const add = (parent: Group | Bone, name: string, position: number[]) => {
    const bone = new Bone()
    bone.name = `mixamorig${name}`
    bone.position.fromArray(position)
    parent.add(bone)
    return bone
  }
  const hips = add(model, 'Hips', [0, 0.9, 0])
  const spine = add(hips, 'Spine', [0, 0.18, 0])
  const chest = add(spine, 'Spine1', [0, 0.17, 0])
  const upperChest = add(chest, 'Spine2', [0, 0.17, 0])
  const head = add(upperChest, 'Head', [0, 0.26, 0])
  for (const side of ['Left', 'Right']) {
    const sign = side === 'Left' ? 1 : -1
    const shoulder = add(upperChest, `${side}Shoulder`, [sign * 0.1, 0, 0])
    const arm = add(shoulder, `${side}Arm`, [sign * 0.1, 0, 0])
    const elbow = add(arm, `${side}ForeArm`, [sign * 0.25, -0.1, 0])
    add(elbow, `${side}Hand`, [sign * 0.2, -0.13, 0.08])
    const leg = add(hips, `${side}UpLeg`, [sign * 0.1, 0, 0])
    const knee = add(leg, `${side}Leg`, [0, -0.45, 0.04])
    add(knee, `${side}Foot`, [0, -0.42, -0.04])
  }
  return {model, hips, head}
}

test('resolves Fullbody IK controls on a rig with optional bones missing', () => {
  const {model, hips, head} = humanoid()
  const rig = resolveFullbodyRig(model, new Vector3(0, 0, 1))!
  expect(rig.hips).toBe(hips)
  expect(rig.points.find(({id}) => id === 'head')).toMatchObject({bone: head})
  expect(
    rig.points.find(({id}) => id === 'head')?.offset?.length(),
  ).toBeGreaterThan(0)
  expect(
    rig.points.filter(({positionEnabled}) => positionEnabled).map(({id}) => id),
  ).toEqual(['armL', 'legL', 'armR', 'legR'])
  expect(rig.points.some(({id}) => id === 'legL:toe')).toBe(false)
})

test.each([0.5, 1, 4])(
  'reduces wrist translation and rotation errors at scale %s',
  (scale) => {
    const {model, hips} = humanoid(scale)
    const wrist = model.getObjectByName('mixamorigLeftHand')!
    const currentPosition = wrist.getWorldPosition(new Vector3())
    const target = currentPosition.clone().add(new Vector3(0, 0.12 * scale, 0))
    const currentRotation = wrist.getWorldQuaternion(new Quaternion())
    const targetRot = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), 0.35)
      .multiply(currentRotation)
    solveIK(
      [{effector: wrist, root: hips, target, targetRot, rotWeight: 1}],
      24,
      0.12,
      {scale},
    )
    expect(
      wrist.getWorldPosition(new Vector3()).distanceTo(target),
    ).toBeLessThan(0.03 * scale)
    expect(
      wrist.getWorldQuaternion(new Quaternion()).angleTo(targetRot),
    ).toBeLessThan(0.05)
    expect(hips.position.y).not.toBeCloseTo(0.9, 4)

    const restored = humanoid(scale)
    const saved = parsePoseValue(serializeCustomPose(capturePose(model)))
    if (saved?.kind !== 'custom')
      throw new Error('Expected a saved custom pose')
    applyPose(restored.model, saved.bones)
    expect(capturePose(restored.model)).toEqual(capturePose(model))
  },
)
