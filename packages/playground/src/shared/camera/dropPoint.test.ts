import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
} from 'three'
import {computeDropPoint} from './dropPoint'

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
})
