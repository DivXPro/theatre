import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import {classifyModel, validatePoseJson} from './classify'

function withBone(root: Group): Group {
  const b = new Bone()
  b.name = 'Hips'
  root.add(b)
  return root
}
function withMesh(root: Group): Group {
  root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  return root
}
const clip = new AnimationClip('idle', 1, [])

describe('classifyModel', () => {
  it('网格+骨架 = model', () => {
    expect(classifyModel(withMesh(withBone(new Group())), [])).toBe('model')
  })
  it('网格、无骨架 = static-model', () => {
    expect(classifyModel(withMesh(new Group()), [])).toBe('static-model')
  })
  it('无网格、有骨架+动画 = animations-only', () => {
    expect(classifyModel(withBone(new Group()), [clip])).toBe('animations-only')
  })
  it('无网格无动画/有骨架无动画/有网格空组 = unusable', () => {
    expect(classifyModel(new Group(), [])).toBe('unusable')
    expect(classifyModel(withBone(new Group()), [])).toBe('unusable')
  })
})

describe('validatePoseJson', () => {
  it('合法姿势返回 rig 和 bones', () => {
    const out = validatePoseJson({
      rig: 'rig-x',
      bones: {Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]}},
    })
    expect(out?.rig).toBe('rig-x')
    expect(Object.keys(out?.bones ?? {})).toEqual(['Hips'])
  })
  it('缺 bones/旋转不是四元数/位置不是三元组 = null', () => {
    expect(validatePoseJson({})).toBeNull()
    expect(validatePoseJson({bones: {Hips: {rotation: [0, 0, 1]}}})).toBeNull()
    expect(validatePoseJson({bones: {Hips: {position: [0, 1]}}})).toBeNull()
    expect(validatePoseJson('x')).toBeNull()
  })
})
