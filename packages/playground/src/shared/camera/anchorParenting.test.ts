// packages/playground/src/shared/camera/anchorParenting.test.ts
import {Euler, Object3D, Vector3} from 'three'
import {
  isDescendantAnchor,
  localOffsetForParent,
  needsParentEstablish,
  shouldClearMissingParent,
  detachAnchorMesh,
} from './aimTargets'

describe('isDescendantAnchor', () => {
  // 父链:A ← B ← C(C 挂 B,B 挂 A);即 B、C 都是 A 的后代,C 是 B 的后代
  const parentOf = (k: string) =>
    (({C: 'anchor:B', B: 'anchor:A', A: ''}) as Record<string, string>)[k] ?? ''
  test('后代判 true;自己/祖先/旁系 false', () => {
    expect(isDescendantAnchor('A', 'B', parentOf)).toBe(true)
    expect(isDescendantAnchor('A', 'C', parentOf)).toBe(true)
    expect(isDescendantAnchor('B', 'C', parentOf)).toBe(true)
    expect(isDescendantAnchor('C', 'B', parentOf)).toBe(false) // B 是 C 的祖先
    expect(isDescendantAnchor('C', 'A', parentOf)).toBe(false)
    expect(isDescendantAnchor('C', 'C', parentOf)).toBe(false) // 自己
  })
})

describe('localOffsetForParent', () => {
  test('父级世界矩阵逆 × 子世界坐标 = 局部偏移', () => {
    const parent = new Object3D()
    parent.position.set(10, 0, 0)
    parent.updateMatrixWorld(true)
    const childWorld = new Vector3(12, 3, -1)
    const out = new Vector3()
    localOffsetForParent(childWorld, parent, out)
    expect(out.x).toBeCloseTo(2)
    expect(out.y).toBeCloseTo(3)
    expect(out.z).toBeCloseTo(-1)
  })
  test('父级带旋转也算得对', () => {
    const parent = new Object3D()
    parent.position.set(0, 5, 0)
    parent.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0))
    parent.updateMatrixWorld(true)
    // 子在世界 (1,5,0):父级绕 Y 转 90°(+X 旋向 -Z),局部 = R⁻¹ × (世界 - 父位置)
    // 手算:R(90°) 把 +X 转到 -Z,故 R⁻¹(1,0,0) = (0,0,1)
    const out = new Vector3()
    localOffsetForParent(new Vector3(1, 5, 0), parent, out)
    expect(out.x).toBeCloseTo(0)
    expect(out.y).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(1)
  })
})

describe('Critical-1 回归:恢复未建立的绑定不被看护清除,由重试补建', () => {
  // 时序(刷新页面,parent 持久绑定到放置模型):第 1 次提交 parentId
  // 是 fallback '',第 2 次提交变回持久值 'model:X',此时模型还在
  // Suspense 加载、lookup 解析不到。旧实现里看护 effect 会把这个
  // 空窗当"父级消失"清掉持久绑定;新实现按下面的切分判定:
  // 看护不清除(从未绑定成功),useFrame 重试循环负责建立,建立后
  // 解析不到才允许清除(真删场景)。
  test('未绑定成功过的父级:看护永不清除;重试在绑定成功后停;真删才清除', () => {
    const parentId = 'model:X'
    // 本会话绑定记录:刷新后为空
    let bound: string | null = null
    // 加载空窗:解析不到,但绑定从未建立 → 看护不清除(Critical-1 核心断言)
    expect(shouldClearMissingParent(bound, parentId, false)).toBe(false)
    // 重试循环:需要建立
    expect(needsParentEstablish(bound, parentId)).toBe(true)
    // 模型加载完,重试建立成功(只挂不换算,position 属性保持持久局部偏移)
    bound = parentId
    expect(needsParentEstablish(bound, parentId)).toBe(false)
    // 建立之后父级真被删(解析不到)→ 看护清除+定格(真删场景行为不变)
    expect(shouldClearMissingParent(bound, parentId, false)).toBe(true)
    // 解析得到 → 不清除
    expect(shouldClearMissingParent(bound, parentId, true)).toBe(false)
  })
  test('闸按 parentId 精确匹配:绑定 A 时 parentId 是 B → 不清除', () => {
    expect(shouldClearMissingParent('anchor:A', 'anchor:B', false)).toBe(false)
    expect(needsParentEstablish('anchor:A', 'anchor:B')).toBe(true)
  })
  test('无父级:看护与重试都不动作', () => {
    expect(shouldClearMissingParent('model:X', '', false)).toBe(false)
    expect(needsParentEstablish('model:X', '')).toBe(false)
  })
})

describe('detachAnchorMesh(终审复审:删锚清幽灵网格)', () => {
  test('绑在伪造骨骼上的锚点网格被移除,骨骼子树无残留', () => {
    const bone = new Object3D()
    const mesh = new Object3D()
    bone.add(mesh)
    expect(bone.children).toContain(mesh)

    detachAnchorMesh(mesh)

    expect(mesh.parent).toBeNull()
    expect(bone.children).toHaveLength(0)
  })
  test('null(卸载时 ref 已置空的等价输入)静默 no-op', () => {
    expect(() => detachAnchorMesh(null)).not.toThrow()
  })
})
