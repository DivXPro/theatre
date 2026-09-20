/**
 * 骨骼锚点接线回归(终审修复波沉淀):放置实例登记后的整条数据链
 * + 目标登记表广播 + 幂等守卫。
 *
 * 覆盖(对应终审 Important-1/Important-2 的行为规格):
 *  - registerBoneAnchors → 相机「瞄准目标」/锚点「父级」两个下拉出现
 *    6 个骨骼项(en/zh 部位名)→ resolveAimTarget/resolveAnchorParent
 *    命中骨骼节点 → unregister 后选项与解析同时消失;
 *  - 骨架完全不认识的模型自然落空(不进 bone: 选项,非错误);
 *  - 四条登记路径的广播:subscribeTargetRegistry 能收到骨骼锚点
 *    (register/unregisterBoneAnchors)与放置实例
 *    (register/unregisterPlacedInstance)的登记通知;
 *  - 幂等守卫:同 placementKey 同根重复登记不重建节点(保住已绑定
 *    锚点网格的场景树身份);换根才重建;注销后再登记允许重建。
 */
import {Bone, Group, Object3D} from 'three'
import {setLanguage, translate} from '@dreamerbird/studio/i18n'
import {
  registerBoneAnchors,
  unregisterBoneAnchors,
  getBoneAnchorObjects,
} from './boneAnchors'
import {
  aimTargetOptions,
  anchorParentOptionsFor,
  resolveAimTarget,
  resolveAnchorParent,
  setAimOptionsSheet,
  subscribeTargetRegistry,
} from './aimTargets'
import {
  registerPlacedInstance,
  unregisterPlacedInstance,
  getPlacedInstances,
} from './PlacementManager'
import {en, zhCN} from './i18n'

const PLACEMENT_KEY = 'Models / Y Bot'
const BONE_IDS = [
  'bone:Models / Y Bot#head',
  'bone:Models / Y Bot#chest',
  'bone:Models / Y Bot#handL',
  'bone:Models / Y Bot#handR',
  'bone:Models / Y Bot#legL',
  'bone:Models / Y Bot#legR',
]

function makeSkeleton() {
  const root = new Object3D()
  const mk = (name: string, parent: Object3D) => {
    const b = new Bone()
    b.name = name
    parent.add(b)
    return b
  }
  const hips = mk('mixamorigHips', root)
  const spine = mk('mixamorigSpine', hips)
  const spine1 = mk('mixamorigSpine1', spine)
  mk('mixamorigSpine2', spine1)
  const head = mk('mixamorigHead', spine1)
  const handL = mk('mixamorigLeftHand', spine1)
  const handR = mk('mixamorigRightHand', spine1)
  const legL = mk('mixamorigLeftLeg', hips)
  const legR = mk('mixamorigRightLeg', hips)
  return {root, head, handL, handR, legL, legR}
}

function stubSheet(placementsJson: string) {
  const registries: Record<string, any> = {}
  return {
    object(key: string) {
      if (!registries[key]) {
        const json = key === 'Placements' ? placementsJson : '[]'
        registries[key] = {
          props: {list: json},
          value: {list: json},
          onValuesChange: () => () => {},
        }
      }
      return registries[key]
    },
  } as any
}

const PLACEMENTS = JSON.stringify([
  {key: PLACEMENT_KEY, position: {x: 0, y: 0, z: 0}},
])

describe('骨骼锚点接线(终审 Important-1/2 回归)', () => {
  beforeAll(() => {
    setLanguage('en')
  })
  afterAll(() => {
    setLanguage('en')
  })

  test('登记后两个下拉出现「Y Bot · 部位」6 项;解析命中骨骼节点;注销后消失', () => {
    const {root, head, handL} = makeSkeleton()
    registerBoneAnchors(PLACEMENT_KEY, root)

    // 1) 运行时 boneAnchors 表:6 项,挂对骨骼
    const anchors = getBoneAnchorObjects()
    expect([...anchors.keys()].sort()).toEqual([...BONE_IDS].sort())
    expect(anchors.get('bone:Models / Y Bot#head')!.parent).toBe(head)
    expect(anchors.get('bone:Models / Y Bot#handL')!.parent).toBe(handL)

    // 2) 相机「瞄准目标」下拉:6 个骨骼项,英文部位名,模型显示名去前缀
    setAimOptionsSheet(stubSheet(PLACEMENTS))
    const aim = aimTargetOptions()
    for (const id of BONE_IDS) expect(aim).toHaveProperty(id)
    expect(aim['bone:Models / Y Bot#head']).toBe('Y Bot · Head')
    expect(aim['bone:Models / Y Bot#handR']).toBe('Y Bot · Right hand')

    // 3) 锚点「父级」下拉同样 6 项
    const parentOpts = anchorParentOptionsFor('Anchor 1')
    for (const id of BONE_IDS) expect(parentOpts).toHaveProperty(id)
    expect(parentOpts['bone:Models / Y Bot#chest']).toBe('Y Bot · Chest')

    // 4) 帧驱动解析:瞄准/父级都能拿到骨骼下的锚点节点
    expect(resolveAimTarget('bone:Models / Y Bot#head')).toBe(
      anchors.get('bone:Models / Y Bot#head'),
    )
    expect(resolveAnchorParent('bone:Models / Y Bot#handL')).toBe(
      anchors.get('bone:Models / Y Bot#handL'),
    )

    // 5) 中文部位名
    setLanguage('zh-CN')
    expect(aimTargetOptions()['bone:Models / Y Bot#head']).toBe('Y Bot · 头')
    expect(aimTargetOptions()['bone:Models / Y Bot#chest']).toBe('Y Bot · 胸口')
    expect(anchorParentOptionsFor('Anchor 1')['bone:Models / Y Bot#legR']).toBe(
      'Y Bot · 右腿',
    )
    setLanguage('en')

    // 6) 注销(删模型/卸载):选项与解析同时消失
    unregisterBoneAnchors(PLACEMENT_KEY)
    expect(getBoneAnchorObjects().size).toBe(0)
    const aimAfter = aimTargetOptions()
    for (const id of BONE_IDS) expect(aimAfter).not.toHaveProperty(id)
    expect(resolveAimTarget('bone:Models / Y Bot#head')).toBeNull()
    expect(resolveAnchorParent('bone:Models / Y Bot#handL')).toBeNull()
  })

  test('骨架完全不认识的模型:自然落空,不出现在选项里(正常行为非错误)', () => {
    const meshOnly = new Object3D()
    meshOnly.add(new Bone()) // 无名骨骼
    registerBoneAnchors('Models / Rock', meshOnly)
    expect(getBoneAnchorObjects().size).toBe(0)
    const aim = aimTargetOptions()
    expect(Object.keys(aim).filter((k) => k.startsWith('bone:'))).toEqual([])
    unregisterBoneAnchors('Models / Rock')
  })

  test('放置实例登记/注销经 subscribeTargetRegistry 广播;骨骼登记的幂等重跑静默', () => {
    const {root} = makeSkeleton()
    const instance = new Group()
    const calls: string[] = []
    const unsub = subscribeTargetRegistry(() => calls.push('notify'))

    // bones 的广播挂在 PlacementManager 的登记 effect 上(纯函数层不广播);
    // 这里验证的是:boneAnchors 登记本身不偷跑广播——幂等守卫的 effect
    // 重跑(注册表增删任一模型)才不会让 ShotCamera/Anchors 空刷重渲染
    registerBoneAnchors(PLACEMENT_KEY, root)
    registerBoneAnchors(PLACEMENT_KEY, root) // 幂等短路,静默
    unregisterBoneAnchors(PLACEMENT_KEY)

    // placedInstances 的广播在 register/unregisterPlacedInstance 本体
    // (usePlacedInstance 委托它们),订阅方按序收到登记与注销各一次
    registerPlacedInstance(PLACEMENT_KEY, instance)
    unregisterPlacedInstance(PLACEMENT_KEY)
    unsub()

    expect(calls).toEqual(['notify', 'notify'])
    expect(getPlacedInstances().size).toBe(0)
  })

  test('幂等守卫:同根重复登记不重建节点;换根才重建;注销后再登记允许重建', () => {
    const {root, head} = makeSkeleton()
    const headId = 'bone:Models / Y Bot#head'

    registerBoneAnchors(PLACEMENT_KEY, root)
    const first = getBoneAnchorObjects().get(headId)!
    expect(first.parent).toBe(head)

    // 同根重复登记(放置注册表增删任一模型 → 所有登记 effect 重跑的场景)
    // 必须保持节点身份,绑在骨骼锚点上的锚点网格才不会脱离场景树
    registerBoneAnchors(PLACEMENT_KEY, root)
    expect(getBoneAnchorObjects().get(headId)).toBe(first)
    expect(getBoneAnchorObjects().size).toBe(6)

    // 换根(热更新/实例重建)才允许重建
    const {root: root2} = makeSkeleton()
    registerBoneAnchors(PLACEMENT_KEY, root2)
    const second = getBoneAnchorObjects().get(headId)!
    expect(second).not.toBe(first)

    // 注销清记录:同根再登记是全新节点(不复用旧身份)
    unregisterBoneAnchors(PLACEMENT_KEY)
    registerBoneAnchors(PLACEMENT_KEY, root2)
    expect(getBoneAnchorObjects().get(headId)).not.toBe(second)

    unregisterBoneAnchors(PLACEMENT_KEY)
  })

  test('六个部位词条 en/zh-CN 齐且不回退 key', () => {
    for (const part of ['head', 'chest', 'handL', 'handR', 'legL', 'legR']) {
      const key = `pg.parts.${part}`
      // 注意:jest toHaveProperty 按 . 分路径,带点的 key 用 hasOwnProperty
      expect(Object.prototype.hasOwnProperty.call(en, key)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(zhCN, key)).toBe(true)
      expect(translate(key)).toBe(en[key])
    }
  })
})
