// packages/playground/src/shared/camera/aimTargets.test.ts
import {Object3D} from 'three'
import {registerMessages, translate} from '@dreamerbird/studio/i18n'
import {
  parseTargetId,
  makeTargetId,
  resolveTargetObject,
  registerAnchorObject,
  getAnchorObjects,
  aimTargetOptions,
} from './aimTargets'
import {makeBoneAnchorId} from './boneAnchors'

function emptyLookup() {
  return {
    anchors: new Map(),
    bones: new Map(),
    models: new Map(),
    cameras: new Map(),
  }
}

describe('parseTargetId / makeTargetId', () => {
  test('四种 kind 互逆', () => {
    expect(parseTargetId('')).toBeNull()
    expect(makeTargetId('anchor', 'Anchor 1')).toBe('anchor:Anchor 1')
    expect(parseTargetId('anchor:Anchor 1')).toEqual({
      kind: 'anchor',
      key: 'Anchor 1',
    })
    expect(makeTargetId('model', 'Models / Y Bot')).toBe('model:Models / Y Bot')
    expect(parseTargetId('model:Models / Y Bot')).toEqual({
      kind: 'model',
      key: 'Models / Y Bot',
    })
    expect(makeTargetId('camera', 'Shot Camera / Camera')).toBe(
      'camera:Shot Camera / Camera',
    )
    expect(parseTargetId('camera:Shot Camera / Camera')).toEqual({
      kind: 'camera',
      key: 'Shot Camera / Camera',
    })
    const boneId = makeBoneAnchorId('Models / Y Bot', 'head')
    expect(parseTargetId(boneId)).toEqual({
      kind: 'bone',
      placementKey: 'Models / Y Bot',
      part: 'head',
    })
    expect(makeTargetId('bone', 'Models / Y Bot', 'head')).toBe(boneId)
  })
  test('坏 id 返回 null', () => {
    expect(parseTargetId('nonsense')).toBeNull()
    expect(parseTargetId('anchor:')).toBeNull()
    expect(parseTargetId('bone:k#nope')).toBeNull()
  })
})

describe('resolveTargetObject', () => {
  test('按 kind 查对应表;空 id 与解析失败都是 null', () => {
    const anchorObj = new Object3D()
    const boneObj = new Object3D()
    const modelObj = new Object3D()
    const camObj = new Object3D()
    const lookup = emptyLookup()
    lookup.anchors.set('Anchor 1', anchorObj)
    lookup.bones.set(makeBoneAnchorId('M1', 'handL'), boneObj)
    lookup.models.set('M1', modelObj)
    lookup.cameras.set('C1', camObj)
    expect(resolveTargetObject('', lookup)).toBeNull()
    expect(resolveTargetObject('anchor:Anchor 1', lookup)).toBe(anchorObj)
    expect(resolveTargetObject(makeBoneAnchorId('M1', 'handL'), lookup)).toBe(
      boneObj,
    )
    expect(resolveTargetObject('model:M1', lookup)).toBe(modelObj)
    expect(resolveTargetObject('camera:C1', lookup)).toBe(camObj)
    expect(resolveTargetObject('anchor:不存在', lookup)).toBeNull()
  })
})

describe('registerAnchorObject', () => {
  test('登记/覆盖/注销(null)', () => {
    const obj = new Object3D()
    registerAnchorObject('Anchor 1', obj)
    expect(getAnchorObjects().get('Anchor 1')).toBe(obj)
    registerAnchorObject('Anchor 1', null)
    expect(getAnchorObjects().size).toBe(0)
  })
})

describe('aimTargetOptions', () => {
  // 选项函数读运行时登记表;此处只验证纯函数层:未注入 sheet 时
  // 只有「无」一项(锚点/骨骼注册表的读取在注入后才有候选,Task 8
  // 统一浏览器冒烟)。动态选项组装依赖 studio 面板渲染上下文,
  // 不进单元测试。
  test('未注入 sheet 时只有「无」一项', () => {
    registerMessages('en', {'pg.props.aimNone': 'None'})
    registerMessages('zh-CN', {'pg.props.aimNone': '无'})
    expect(aimTargetOptions()).toEqual({'': translate('pg.props.aimNone')})
  })
})
