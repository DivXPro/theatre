import {Vector3} from 'three'
import {
  autoHandles,
  buildCurve,
  buildLinePositions,
  effectiveHandles,
  extendPathPoint,
  nextPointKey,
  parsePathPoints,
  sampleEntries,
  seedArcPoints,
  serializePathPoints,
  withDraggedHandle,
  withMovedPoint,
} from './pathModel'
import type {PathPointEntry} from './pathModel'

const pt = (key: string, x: number, y = 0, z = 0): PathPointEntry => ({
  key,
  position: {x, y, z},
})

describe('parsePathPoints / serializePathPoints', () => {
  it('往返一致(含手柄)', () => {
    const entries = [
      {key: 'P1', position: {x: 1, y: 2, z: 3}},
      {
        key: 'P2',
        position: {x: -1, y: 0, z: 0.5},
        handles: {left: {x: -0.5, y: 0, z: 0}, right: {x: 0.5, y: 0, z: 0}},
      },
    ]
    expect(parsePathPoints(serializePathPoints(entries))).toEqual(entries)
  })

  it('坏 JSON / 非数组 / 缺字段都当空名单', () => {
    expect(parsePathPoints('not json')).toEqual([])
    expect(parsePathPoints('{"a":1}')).toEqual([])
    expect(parsePathPoints('[{"key":"P1"}]')).toEqual([])
    expect(
      parsePathPoints('[{"key":"P1","position":{"x":1,"y":"bad","z":3}}]'),
    ).toEqual([])
  })

  it('坏手柄被丢弃(回自动),点本身保留', () => {
    const parsed = parsePathPoints(
      '[{"key":"P1","position":{"x":1,"y":2,"z":3},"handles":{"left":{"x":"bad"}}}]',
    )
    expect(parsed).toEqual([{key: 'P1', position: {x: 1, y: 2, z: 3}}])
  })
})

describe('nextPointKey', () => {
  it('空名单从 P1 开始', () => {
    expect(nextPointKey([])).toBe('P1')
  })

  it('取最大编号 +1,删过的号不复用', () => {
    expect(nextPointKey([pt('P1', 0), pt('P3', 0)])).toBe('P4')
  })

  it('忽略不符合命名规范的 key', () => {
    expect(nextPointKey([{key: 'foo', position: {x: 0, y: 0, z: 0}}])).toBe(
      'P1',
    )
  })
})

describe('seedArcPoints', () => {
  it('三个点,起点就是当前机位', () => {
    const [p0, p1, p2] = seedArcPoints({x: 8, y: 3, z: 0}, {x: 0, y: 0, z: 0})
    expect(p0).toEqual({x: 8, y: 3, z: 0})
    // 绕 Y 轴转 60° 后离目标距离不变
    const r0 = Math.hypot(8, 0)
    const r2 = Math.hypot(p2!.x, p2!.z)
    expect(r2).toBeCloseTo(r0, 5)
    // 中点向外鼓:离目标比首尾连线的中点更远
    const midDist = Math.hypot((8 + p2!.x) / 2, (0 + p2!.z) / 2)
    expect(Math.hypot(p1!.x, p1!.z)).toBeGreaterThan(midDist)
  })
})

describe('extendPathPoint', () => {
  it('沿最后一段方向延伸等长', () => {
    expect(extendPathPoint([pt('P1', 0), pt('P2', 1, 2, 3)])).toEqual({
      x: 2,
      y: 4,
      z: 6,
    })
  })

  it('只有一个点时往 +x 挪 2', () => {
    expect(extendPathPoint([pt('P1', 5, 1, 1)])).toEqual({x: 7, y: 1, z: 1})
  })
})

describe('autoHandles / effectiveHandles', () => {
  it('中间点:两侧等长共线,方向沿前后点差分', () => {
    const h = autoHandles(
      [
        {x: 0, y: 0, z: 0},
        {x: 3, y: 0, z: 0},
        {x: 3, y: 6, z: 0},
      ],
      1,
    )
    // 差分 (3,6,0)/6 = (0.5,1,0)
    expect(h.right).toEqual({x: 0.5, y: 1, z: 0})
    expect(h.left).toEqual({x: -0.5, y: -1, z: 0})
  })

  it('端点:单侧差分的 1/3,另一侧镜像', () => {
    const positions = [
      {x: 0, y: 0, z: 0},
      {x: 3, y: 0, z: 0},
      {x: 6, y: 0, z: 0},
    ]
    const first = autoHandles(positions, 0)
    expect(first.right).toEqual({x: 1, y: 0, z: 0})
    expect(first.left).toEqual({x: -1, y: 0, z: 0})
    const last = autoHandles(positions, 2)
    expect(last.left).toEqual({x: -1, y: 0, z: 0})
    expect(last.right).toEqual({x: 1, y: 0, z: 0})
  })

  it('有手动手柄时优先手动', () => {
    const manual = {left: {x: -2, y: 0, z: 0}, right: {x: 2, y: 0, z: 0}}
    const entries = [{...pt('P1', 0), handles: manual}, pt('P2', 5)]
    expect(effectiveHandles(entries, 0)).toBe(manual)
  })
})

describe('withMovedPoint', () => {
  it('只换位置,手柄偏移原样保留(跟着点走)', () => {
    const handles = {left: {x: -1, y: 0, z: 0}, right: {x: 1, y: 0, z: 0}}
    const entries = [{...pt('P1', 0), handles}, pt('P2', 5)]
    const next = withMovedPoint(entries, 'P1', {x: 1, y: 1, z: 1})
    expect(next[0]).toEqual({key: 'P1', position: {x: 1, y: 1, z: 1}, handles})
    expect(next[1]).toBe(entries[1])
  })
})

describe('withDraggedHandle', () => {
  it('自动点一拖变手动:被拖侧取新值,另一侧镜像方向、保留自动长度', () => {
    // P2 的自动切线:差分 (P3-P1)/6 = (1,0,0),左长 1 右长 1
    const entries = [pt('P1', 0), pt('P2', 3), pt('P3', 6)]
    const next = withDraggedHandle(entries, 'P2', 'right', {x: 0, y: 2, z: 0})
    const h = next[1]!.handles!
    expect(h.right).toEqual({x: 0, y: 2, z: 0})
    // 左侧镜像到 (0,-1,0) 方向,长度保留自动值 1
    expect(h.left.x).toBeCloseTo(0, 6)
    expect(h.left.y).toBeCloseTo(-1, 6)
    expect(h.left.z).toBeCloseTo(0, 6)
  })

  it('手动点再拖:另一侧长度保留手动值', () => {
    const entries = [
      pt('P1', 0),
      {
        ...pt('P2', 3),
        handles: {left: {x: -4, y: 0, z: 0}, right: {x: 4, y: 0, z: 0}},
      },
      pt('P3', 6),
    ]
    const next = withDraggedHandle(entries, 'P2', 'left', {x: 0, y: 1, z: 0})
    const h = next[1]!.handles!
    expect(h.left).toEqual({x: 0, y: 1, z: 0})
    // 右侧镜像到 (0,-4,0):长度保留 4
    expect(h.right.x).toBeCloseTo(0, 6)
    expect(h.right.y).toBeCloseTo(-4, 6)
  })

  it('找不到 key 时原样返回副本', () => {
    const entries = [pt('P1', 0), pt('P2', 3)]
    const next = withDraggedHandle(entries, 'PX', 'left', {x: 1, y: 0, z: 0})
    expect(next).toEqual(entries)
    expect(next).not.toBe(entries)
  })
})

describe('sampleEntries / sampleCurve', () => {
  const out = new Vector3()

  it('0 个点返回 false(调用方回退手动)', () => {
    expect(sampleEntries([], 0.5, out)).toBe(false)
  })

  it('1 个点时任何进度都取它(聚焦锁单点)', () => {
    const entries = [pt('P1', 1, 2, 3)]
    for (const u of [0, 0.3, 1]) {
      expect(sampleEntries(entries, u, out)).toBe(true)
      expect(out.x).toBe(1)
      expect(out.y).toBe(2)
      expect(out.z).toBe(3)
    }
  })

  it('进度越界被夹到 0..1', () => {
    const entries = [pt('P1', 0), pt('P2', 10)]
    sampleEntries(entries, -1, out)
    expect(out.x).toBeCloseTo(0, 5)
    sampleEntries(entries, 2, out)
    expect(out.x).toBeCloseTo(10, 5)
  })

  it('弧长等比:两段不等长时,u=0.5 落在全长一半处', () => {
    // 共线三点 (0,0,0)->(1,0,0)->(11,0,0):第一段长 1,第二段长 10,全长 11
    // 共线时自动手柄也共线,曲线不偏离 x 轴
    const entries = [pt('P1', 0), pt('P2', 1), pt('P3', 11)]
    sampleEntries(entries, 0.5, out)
    // 弧长一半 = 5.5,落在第二段上 x≈5.5(弧长映射是数值近似,放宽到 0.5)
    expect(out.x).toBeGreaterThan(4.5)
    expect(out.x).toBeLessThan(6.5)
    // 若是参数等比(getPoint),u=0.5 会落在两段参数的分界 x≈1 附近
    expect(out.x).toBeGreaterThan(2)
  })

  it('手动手柄改变曲线形状(拉出鼓包)', () => {
    // 两个点一条直线段,把两端手柄都往 +y 拉,中点应明显抬离 x 轴
    const entries = [
      {
        ...pt('P1', 0),
        handles: {left: {x: 0, y: 4, z: 0}, right: {x: 0, y: 4, z: 0}},
      },
      {
        ...pt('P2', 10),
        handles: {left: {x: 0, y: 4, z: 0}, right: {x: 0, y: 4, z: 0}},
      },
    ]
    sampleEntries(entries, 0.5, out)
    expect(out.y).toBeGreaterThan(2)
  })
})

describe('buildLinePositions', () => {
  it('不足两个点返回 0', () => {
    const buf = new Float32Array(30)
    expect(buildLinePositions([pt('P1', 0)], buf)).toBe(0)
    expect(buildLinePositions([], buf)).toBe(0)
  })

  it('顶点数随缓冲自适应,不溢出,首尾是路径端点', () => {
    const buf = new Float32Array(33 * 3)
    const entries = [pt('P1', 0), pt('P2', 1), pt('P3', 2)]
    const n = buildLinePositions(entries, buf)
    expect(n).toBeLessThanOrEqual(33)
    expect(n).toBeGreaterThan(3)
    expect(buf[0]).toBeCloseTo(0, 5)
    expect(buf[(n - 1) * 3]).toBeCloseTo(2, 5)
  })

  it('点多时每段细分自动降档,仍然不溢出', () => {
    const buf = new Float32Array(64 * 3)
    const entries = Array.from({length: 20}, (_, i) => pt(`P${i + 1}`, i))
    const n = buildLinePositions(entries, buf)
    expect(n).toBeLessThanOrEqual(64)
    expect(buf[0]).toBeCloseTo(0, 5)
    expect(buf[(n - 1) * 3]).toBeCloseTo(19, 5)
  })
})

describe('buildCurve', () => {
  it('不足两个点返回 null', () => {
    expect(buildCurve([])).toBeNull()
    expect(buildCurve([pt('P1', 0)])).toBeNull()
  })
})
