// packages/playground/src/shared/camera/anchorParenting.test.ts
import {Euler, Object3D, Vector3} from 'three'
import {isDescendantAnchor, localOffsetForParent} from './aimTargets'

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
