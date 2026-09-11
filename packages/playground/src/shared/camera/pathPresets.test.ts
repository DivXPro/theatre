import {PATH_PRESETS, findFreeSpot, presetPoints} from './pathPresets'
import type {PathPreset} from './pathPresets'

const byId = (id: string): PathPreset => {
  const p = PATH_PRESETS.find((p) => p.id === id)
  if (!p) throw new Error(`missing preset ${id}`)
  return p
}

describe('presetPoints', () => {
  const center = {x: 10, y: 4, z: -2}

  it('环绕圆:半径 5 的 8 点,全部与中心共面(y 相等)', () => {
    const pts = presetPoints(byId('circle'), center)
    expect(pts).toHaveLength(8)
    for (const p of pts) {
      expect(p.y).toBe(4)
      expect(Math.hypot(p.x - 10, p.z + 2)).toBeCloseTo(5, 6)
    }
  })

  it('直线往返:2 点,长 10,中点是落点', () => {
    const pts = presetPoints(byId('line'), center)
    expect(pts).toHaveLength(2)
    expect(pts[0]).toEqual({x: 5, y: 4, z: -2})
    expect(pts[1]).toEqual({x: 15, y: 4, z: -2})
  })

  it('弧线:半径 6 的 180° 弧,5 点共面', () => {
    const pts = presetPoints(byId('arc'), center)
    expect(pts).toHaveLength(5)
    for (const p of pts) {
      expect(p.y).toBe(4)
      expect(Math.hypot(p.x - 10, p.z + 2)).toBeCloseTo(6, 6)
    }
    // 首尾张角 180°
    expect(pts[0].x).toBeCloseTo(16, 6)
    expect(pts[4].x).toBeCloseTo(4, 6)
  })

  it('8 字:12 点,两圆在落点相切', () => {
    const pts = presetPoints(byId('figure8'), center)
    expect(pts).toHaveLength(12)
    for (const p of pts) expect(p.y).toBe(4)
    // 左圆右缘与右圆左缘都过落点
    expect(pts[0].x).toBeCloseTo(10, 6)
    expect(pts[0].z).toBeCloseTo(-2, 6)
    expect(pts[6].x).toBeCloseTo(10, 6)
    expect(pts[6].z).toBeCloseTo(-2, 6)
  })
})

describe('findFreeSpot', () => {
  it('空场景落原点', () => {
    expect(findFreeSpot([])).toEqual({x: 0, y: 0, z: 0})
  })

  it('原点被占沿 +X 每次错开 2,直到空位', () => {
    expect(findFreeSpot([{x: 0.5, y: 0, z: 0.5}])).toEqual({x: 2, y: 0, z: 0})
    expect(
      findFreeSpot([
        {x: 0, y: 0, z: 0},
        {x: 2, y: 0, z: 0},
      ]),
    ).toEqual({x: 4, y: 0, z: 0})
  })

  it('远处占用不影响原点', () => {
    expect(findFreeSpot([{x: 10, y: 0, z: 10}])).toEqual({x: 0, y: 0, z: 0})
  })

  it('自定义 base 生效', () => {
    expect(findFreeSpot([], {x: 3, y: 0, z: 3})).toEqual({x: 3, y: 0, z: 3})
  })
})
