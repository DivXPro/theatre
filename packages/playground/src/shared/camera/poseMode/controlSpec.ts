// packages/playground/src/shared/camera/poseMode/controlSpec.ts
/**
 * 人形骨架控制点装配表:用 threeIK 的骨名映射(Mixamo/VRM/无前缀预设)
 * 把模型骨名翻成人形 profile,产出标准控制点集合。关键骨(REQUIRED_HUMANOID_
 * BONES:髋/脊柱/头/肩/四肢)缺任一 → null = 不支持摆姿势(菜单置灰、双击静默)。
 */
import {Vector3} from 'three'
import type {Object3D, Bone} from 'three'
import {suggestBoneMap} from '@dreamerbird/threeik'
import type {ControlPointSpec} from '@dreamerbird/threeik/controls'
import {collectBoneNames} from '../assetLibrary/rig'

/** 父不是 Bone 的第一根 Bone = 骨架根(SkeletonRig 的构造参数) */
export function findRootBone(root: Object3D): Bone | null {
  let found: Bone | null = null
  root.traverse((o) => {
    if (found) return
    const asBone = o as Bone
    if (asBone.isBone && !(o.parent as Bone | null)?.isBone) found = asBone
  })
  return found
}

export function resolveControlSpec(
  root: Object3D,
  facing: Vector3 = new Vector3(0, 0, -1),
): ControlPointSpec[] | null {
  const names = collectBoneNames(root)
  if (names.length === 0) return null
  const {map, coverage} = suggestBoneMap(names)
  if (coverage < 1) return null // coverage 只算关键骨;1 = 关键骨全映射

  const bone = (profile: string): string => map.findModelBone(profile)!
  const optional = (profile: string): string | null =>
    map.findModelBone(profile)

  // 肘/膝 pole 初始方向提示(世界坐标):肘朝后、膝朝前。世界矩阵先刷新,
  // 保证菜单场景外(测试/刚进会话)也能取到正确位置。
  root.updateWorldMatrix(true, true)
  const worldPosOf = (name: string): Vector3 => {
    const obj = root.getObjectByName(name)!
    return obj.getWorldPosition(new Vector3())
  }
  const behind = facing.clone().normalize().multiplyScalar(-0.25)
  const ahead = facing.clone().normalize().multiplyScalar(0.25)

  const armL = [bone('LeftUpperArm'), bone('LeftLowerArm'), bone('LeftHand')]
  const armR = [bone('RightUpperArm'), bone('RightLowerArm'), bone('RightHand')]
  const legL = [bone('LeftUpperLeg'), bone('LeftLowerLeg'), bone('LeftFoot')]
  const legR = [bone('RightUpperLeg'), bone('RightLowerLeg'), bone('RightFoot')]
  const neck = optional('Neck')
  const chest = optional('UpperChest') ?? optional('Chest') ?? bone('Spine')

  const limb = (
    name: string,
    [rootBone, middleBone, endBone]: string[],
    poleOffset: Vector3,
  ): ControlPointSpec => ({
    kind: 'limb',
    name,
    rootBone,
    middleBone,
    endBone,
    endRotation: true,
    rootRotation: true,
    pole: {position: worldPosOf(middleBone).add(poleOffset)},
  })

  return [
    {kind: 'root', name: 'hips', bone: bone('Hips'), rotation: true},
    limb('armL', armL, behind),
    limb('armR', armR, behind),
    limb('legL', legL, ahead),
    limb('legR', legR, ahead),
    // 排序即语义:脊柱链先解,胸口环在弯腰之上拧上半身,头部注视最后重新瞄准
    {
      kind: 'chain',
      name: 'spine',
      rootBone: bone('Spine'),
      endBone: neck ?? bone('Head'),
    },
    {kind: 'bone', name: 'chest', bone: chest},
    ...(neck
      ? [
          {
            kind: 'lookAt',
            name: 'head',
            rootBone: neck,
            endBone: bone('Head'),
          } as ControlPointSpec,
        ]
      : []),
  ]
}
