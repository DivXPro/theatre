import {
  PATH_PRESETS,
  findFreeSpot,
  presetPlacement,
  presetPoints,
} from './pathPresets'
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

  it('推近:两点直线,终点比起点离主体更近 8', () => {
    const pts = presetPoints(byId('dollyIn'), center)
    expect(pts).toHaveLength(2)
    const dist = (p: {x: number; z: number}) => Math.hypot(p.x - 10, p.z + 2)
    expect(dist(pts[0]!)).toBeCloseTo(10, 6)
    expect(dist(pts[1]!)).toBeCloseTo(2, 6)
  })

  it('拉远拉升:高度与距离都单调递增', () => {
    const pts = presetPoints(byId('reveal'), center)
    expect(pts).toHaveLength(3)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeGreaterThan(pts[i - 1]!.y)
      expect(Math.abs(pts[i]!.z + 2)).toBeGreaterThan(
        Math.abs(pts[i - 1]!.z + 2),
      )
    }
  })

  it('螺旋上升:16 点,半径恒定 5,高度从落点单调爬到 +5', () => {
    const pts = presetPoints(byId('spiralUp'), center)
    expect(pts).toHaveLength(16)
    expect(pts[0]!.y).toBe(4)
    expect(pts[15]!.y).toBeCloseTo(9, 6)
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(pts[i]!.x - 10, pts[i]!.z + 2)).toBeCloseTo(5, 6)
      if (i > 0) expect(pts[i]!.y).toBeGreaterThan(pts[i - 1]!.y)
    }
  })

  it('升降摇臂:高度单调递增,水平位置基本不动(轻微前推)', () => {
    const pts = presetPoints(byId('crane'), center)
    expect(pts).toHaveLength(3)
    expect(pts[0]!.y).toBeCloseTo(4.5, 6)
    expect(pts[2]!.y).toBeCloseTo(10, 6)
    // 前推幅度远小于爬升幅度
    expect(Math.abs(pts[0]!.z - pts[2]!.z)).toBeLessThan(2)
    expect(pts[2]!.y - pts[0]!.y).toBeGreaterThan(4)
  })

  it('环绕推近:12 点共面,半径从 7 单调收缩到 2.5', () => {
    const pts = presetPoints(byId('orbitPush'), center)
    expect(pts).toHaveLength(12)
    const r = (p: {x: number; z: number}) => Math.hypot(p.x - 10, p.z + 2)
    expect(r(pts[0]!)).toBeCloseTo(7, 6)
    expect(r(pts[11]!)).toBeCloseTo(2.5, 6)
    for (let i = 1; i < pts.length; i++) {
      expect(r(pts[i]!)).toBeLessThan(r(pts[i - 1]!))
      expect(pts[i]!.y).toBe(4)
    }
  })

  it('俯冲:高度单调递减,越来越靠近主体', () => {
    const pts = presetPoints(byId('dive'), center)
    expect(pts).toHaveLength(4)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeLessThan(pts[i - 1]!.y)
      expect(Math.abs(pts[i]!.z + 2)).toBeLessThan(Math.abs(pts[i - 1]!.z + 2))
    }
    // 最低点不穿地
    expect(pts[3]!.y).toBeGreaterThan(4)
  })

  it('立体 8 字:12 点,水平投影仍是相切双圆,高度有起伏', () => {
    const pts = presetPoints(byId('figure8v'), center)
    expect(pts).toHaveLength(12)
    // 水平结构同平面 8 字
    expect(pts[0].x).toBeCloseTo(10, 6)
    expect(pts[0].z).toBeCloseTo(-2, 6)
    expect(pts[6].x).toBeCloseTo(10, 6)
    // 高度有正有负地围绕落点起伏
    const ys = pts.map((p) => p.y - 4)
    expect(Math.max(...ys)).toBeGreaterThan(0.5)
    expect(Math.min(...ys)).toBeLessThan(-0.5)
  })
})

describe('presetPlacement', () => {
  const center = {x: 10, y: 4, z: -2}

  it('落点进路径位置变换,控制点围绕局部原点生成', () => {
    for (const preset of PATH_PRESETS) {
      const {points, position} = presetPlacement(preset, center)
      expect(position).toEqual(center)
      expect(points).toEqual(presetPoints(preset, {x: 0, y: 0, z: 0}))
    }
  })

  it('局部点 + 位置 = 直接以落点为中心的世界点(全部预设)', () => {
    for (const preset of PATH_PRESETS) {
      const {points, position} = presetPlacement(preset, center)
      const world = presetPoints(preset, center)
      expect(points).toHaveLength(world.length)
      points.forEach((p, i) => {
        expect(p.x + position.x).toBeCloseTo(world[i]!.x, 6)
        expect(p.y + position.y).toBeCloseTo(world[i]!.y, 6)
        expect(p.z + position.z).toBeCloseTo(world[i]!.z, 6)
      })
    }
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
