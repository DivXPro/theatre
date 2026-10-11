import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from 'three'
import type {Object3D} from 'three'
import {
  computeDropPoint,
  computeViewPlanePoint,
  computeVerticalConstraintPoint,
  computeHorizontalConstraintPoint,
} from './dropPoint'

const rect = {left: 0, top: 0, width: 800, height: 600}

function groundCam() {
  const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  c.position.set(0, 10, 20)
  c.lookAt(0, 0, 0)
  c.updateMatrixWorld()
  return c
}

describe('computeDropPoint', () => {
  it('指向地面:命中 y=0 平面', () => {
    const p = computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set(),
      rect,
      400,
      300,
    )
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('视线朝天:退到前方 30 个单位并压到地面', () => {
    const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    c.position.set(0, 10, 20)
    c.lookAt(0, 30, -10) // 抬头,中心射线打不到地面
    c.updateMatrixWorld()
    const p = computeDropPoint(new Raycaster(), c, new Set(), rect, 400, 300)
    expect(p.y).toBe(0)
    expect(p.z).toBeCloseTo(-4.96, 1)
  })

  it('登记过的表面优先于地面', () => {
    const slab = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial())
    slab.rotation.x = -Math.PI / 2
    slab.position.y = 2
    slab.updateMatrixWorld()
    const p = computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set([slab]),
      rect,
      400,
      300,
    )
    expect(p.y).toBeCloseTo(2, 6)
  })

  it('未登记的物体不参与命中(地面兜底)', () => {
    const p = computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set(),
      rect,
      400,
      300,
    )
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('相机贴地:脚下 0.5 以内的地面命中被丢弃,回退前方 30 压到地面', () => {
    // 相机 y=0.3 斜向下看:地面命中距相机 ≈0.424(<0.5),没有放置意义
    const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    c.position.set(0, 0.3, 0)
    c.lookAt(0, 0, -0.3)
    c.updateMatrixWorld()
    const p = computeDropPoint(new Raycaster(), c, new Set(), rect, 400, 300)
    // 不是脚下那个命中(那在 z≈-0.3),而是前方 30 个单位压到地面
    expect(p.y).toBe(0)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(-21.21, 1)
  })

  it('命中表面比地面还远时选地面', () => {
    // 竖直平面在 z=-10:中心射线先命中地面(原点,t≈22.4),
    // 平面命中在 (0,-5,-10),t≈33.5,更远 → 选地面
    const wall = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial())
    wall.position.set(0, 0, -10)
    wall.updateMatrixWorld()
    const p = computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set([wall]),
      rect,
      400,
      300,
    )
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('命中登记根内部的网格:out.surfaceRoot 回填到登记根(不是深层网格)', () => {
    // 登记根是个分组,里面套一层子分组再放网格(模拟放置模型的实例结构)
    const root = new Group()
    const inner = new Group()
    const slab = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial())
    slab.rotation.x = -Math.PI / 2
    slab.position.y = 2
    inner.add(slab)
    inner.position.set(1, 0, 1)
    root.add(inner)
    root.position.set(3, 0, 3)
    root.updateMatrixWorld(true)
    const out: {surfaceRoot: Object3D | null} = {surfaceRoot: null}
    const p = computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set([root]),
      rect,
      400,
      300,
      out,
    )
    // 命中点在 (4, 2, 4)(分组偏移叠出来了),回填的是登记根本身
    expect(p.y).toBeCloseTo(2, 6)
    expect(out.surfaceRoot).toBe(root)
  })

  it('地面兜底时 out.surfaceRoot 为 null', () => {
    const out: {surfaceRoot: Object3D | null} = {surfaceRoot: null}
    computeDropPoint(
      new Raycaster(),
      groundCam(),
      new Set(),
      rect,
      400,
      300,
      out,
    )
    expect(out.surfaceRoot).toBeNull()
  })
})

describe('computeViewPlanePoint', () => {
  // 斜视相机在 (0,10,20) 看向原点,锚点取原点(深度≈22.4)
  const anchor = new Vector3(0, 0, 0)

  it('落点恒在过锚点的视平面上(与视线垂直)', () => {
    const cam = groundCam()
    const forward = cam.getWorldDirection(new Vector3())
    for (const [x, y] of [
      [400, 300],
      [200, 150],
      [600, 450],
    ] as const) {
      const p = computeViewPlanePoint(new Raycaster(), cam, rect, x, y, anchor)
      expect(p).not.toBeNull()
      expect(p!.clone().sub(anchor).dot(forward)).toBeCloseTo(0, 6)
    }
  })

  it('指针上移 = 世界升高,下移 = 降低(Blender G 默认手感)', () => {
    const cam = groundCam()
    const up = computeViewPlanePoint(
      new Raycaster(),
      cam,
      rect,
      400,
      100,
      anchor,
    )!
    const mid = computeViewPlanePoint(
      new Raycaster(),
      cam,
      rect,
      400,
      300,
      anchor,
    )!
    const down = computeViewPlanePoint(
      new Raycaster(),
      cam,
      rect,
      400,
      500,
      anchor,
    )!
    expect(up.y).toBeGreaterThan(mid.y)
    expect(down.y).toBeLessThan(mid.y)
  })

  it('顶视时退化为水平面:任意指针位置 y 恒等于锚点 y', () => {
    const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    c.position.set(0, 20, 0.001) // 近乎正上方(完全 0 会让 lookAt 退化)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    const a = new Vector3(0, 5, 0)
    for (const [x, y] of [
      [400, 300],
      [100, 100],
      [700, 500],
    ] as const) {
      // 相机带了 0.001 的防退化偏移,平面略微倾斜,精度放到毫米级
      const p = computeViewPlanePoint(new Raycaster(), c, rect, x, y, a)!
      expect(p.y).toBeCloseTo(5, 2)
    }
  })
})

describe('computeVerticalConstraintPoint', () => {
  // 斜视相机,基准点 (3, 2, -4):竖直约束 = 锁定 x/z,只动 y
  const base = new Vector3(3, 2, -4)

  it('锁定基准点的 x/z,指针上下移动只改变 y', () => {
    const cam = groundCam()
    const up = computeVerticalConstraintPoint(
      new Raycaster(),
      cam,
      rect,
      400,
      100,
      base,
    )!
    const mid = computeVerticalConstraintPoint(
      new Raycaster(),
      cam,
      rect,
      400,
      300,
      base,
    )!
    const down = computeVerticalConstraintPoint(
      new Raycaster(),
      cam,
      rect,
      400,
      500,
      base,
    )!
    for (const p of [up, mid, down]) {
      expect(p.x).toBeCloseTo(3, 6)
      expect(p.z).toBeCloseTo(-4, 6)
    }
    expect(up.y).toBeGreaterThan(mid.y)
    expect(down.y).toBeLessThan(mid.y)
  })

  it('指针正对基准点时 y ≈ 基准 y', () => {
    const cam = groundCam()
    cam.lookAt(base) // 中心射线穿过基准点
    cam.updateMatrixWorld()
    const p = computeVerticalConstraintPoint(
      new Raycaster(),
      cam,
      rect,
      400,
      300,
      base,
    )!
    expect(p.y).toBeCloseTo(2, 4)
  })

  it('视线与竖直轴平行(正顶视)时返回 null', () => {
    const c = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    c.position.set(3, 20, -4) // 正好在基准点正上方
    c.lookAt(base)
    c.updateMatrixWorld()
    expect(
      computeVerticalConstraintPoint(new Raycaster(), c, rect, 400, 300, base),
    ).toBeNull()
  })
})

describe('computeHorizontalConstraintPoint', () => {
  const base = new Vector3(3, 2, -4)

  it('锁定基准高度:任意指针位置 y 恒等于基准 y,x/z 跟随指针', () => {
    const cam = groundCam()
    const ps = (
      [
        [400, 300],
        [200, 400],
        [600, 200],
      ] as const
    ).map(
      ([x, y]) =>
        computeHorizontalConstraintPoint(
          new Raycaster(),
          cam,
          rect,
          x,
          y,
          base,
        )!,
    )
    for (const p of ps) expect(p).not.toBeNull()
    for (const p of ps) expect(p.y).toBeCloseTo(2, 6)
    // 指针位置不同,水平落点确实不同(不是钉死在一个点)
    expect(ps[0]!.distanceTo(ps[1]!)).toBeGreaterThan(0.5)
    expect(ps[0]!.distanceTo(ps[2]!)).toBeGreaterThan(0.5)
  })
})
