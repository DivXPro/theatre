import {PATH_PRESETS} from './pathPresets'
import {
  buildPresetThumb,
  smoothPath,
  THUMB_VH,
  THUMB_VW,
} from './presetThumbGeometry'

/** 抽出 path d 里的所有坐标数对 */
function coordsOf(d: string): Array<[number, number]> {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < nums.length; i += 2)
    out.push([nums[i]!, nums[i + 1]!])
  return out
}

describe('smoothPath', () => {
  it('两点退化直线,三点成平滑曲线', () => {
    expect(
      smoothPath(
        [
          [0, 0],
          [10, 0],
        ],
        false,
      ),
    ).toBe('M 0 0 L 10.0 0.0')
    const d = smoothPath(
      [
        [0, 0],
        [5, 5],
        [10, 0],
      ],
      false,
    )
    expect(d.startsWith('M 0.0 0.0 C')).toBe(true)
    expect(d.endsWith('10.0 0.0')).toBe(true)
  })

  it('闭合路径以 Z 收尾,段数等于点数;开放路径段数少一', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    expect(smoothPath(pts, true).endsWith('Z')).toBe(true)
    expect((smoothPath(pts, true).match(/C /g) ?? []).length).toBe(4)
    expect((smoothPath(pts, false).match(/C /g) ?? []).length).toBe(3)
  })
})

describe('buildPresetThumb', () => {
  it('11 个预设全部产出合法几何,坐标不出 viewBox', () => {
    expect(PATH_PRESETS).toHaveLength(11)
    for (const preset of PATH_PRESETS) {
      const thumb = buildPresetThumb(preset)
      expect(thumb.d.length).toBeGreaterThan(0)
      expect(thumb.gridD.length).toBeGreaterThan(0)
      // 网格和路径的所有坐标都在 viewBox 内
      for (const [x, y] of [...coordsOf(thumb.d), ...coordsOf(thumb.gridD)]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(THUMB_VW)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(THUMB_VH)
      }
      // 主体十字也在框内
      expect(thumb.subject[0]).toBeGreaterThanOrEqual(0)
      expect(thumb.subject[0]).toBeLessThanOrEqual(THUMB_VW)
      expect(thumb.subject[1]).toBeGreaterThanOrEqual(0)
      expect(thumb.subject[1]).toBeLessThanOrEqual(THUMB_VH)
    }
  })

  it('带高度的预设有地面投影,平面预设没有', () => {
    const withHeight = ['reveal', 'spiralUp', 'crane', 'dive', 'figure8v']
    for (const preset of PATH_PRESETS) {
      const thumb = buildPresetThumb(preset)
      if (withHeight.includes(preset.id)) {
        expect(thumb.groundD).toBeDefined()
      } else {
        expect(thumb.groundD).toBeUndefined()
      }
    }
  })

  it('闭合预设的路径以 Z 收尾,开放的不闭合', () => {
    for (const preset of PATH_PRESETS) {
      const thumb = buildPresetThumb(preset)
      expect(thumb.d.endsWith('Z')).toBe(preset.closed)
    }
  })

  it('升降摇臂:路径主体在主体十字上方(屏幕上 y 更小)', () => {
    const crane = PATH_PRESETS.find((p) => p.id === 'crane')!
    const thumb = buildPresetThumb(crane)
    const ys = coordsOf(thumb.d).map(([, y]) => y)
    // 路径最高点明显高于主体(屏幕坐标 y 更小)
    expect(Math.min(...ys)).toBeLessThan(thumb.subject[1] - 10)
  })
})
