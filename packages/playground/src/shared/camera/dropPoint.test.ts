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
})
