import {AgentApiError} from '../agent/errors'
import {
  clampStillTime,
  normalizeClayColor,
  planVideoFrames,
  resolveOutputSize,
  resolveRenderOptions,
  validateStillExportArgs,
  validateVideoExportArgs,
} from './previsTypes'

function expectInvalid(fn: () => unknown, message?: string) {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AgentApiError)
  expect((caught as AgentApiError).code).toBe('INVALID_ARGUMENT')
  if (message) expect((caught as AgentApiError).message).toContain(message)
}

describe('captureStill 参数校验', () => {
  test('接受完整参数并保留 timeMs', () => {
    expect(
      validateStillExportArgs({
        cameraId: 'camera:Cam 1',
        renderMode: 'clay',
        output: {width: 1920, height: 1080},
        aspectRatio: '9:16',
        clayColor: '#ABC',
        background: 'transparent',
        timeMs: 1234,
      }),
    ).toEqual({
      cameraId: 'camera:Cam 1',
      renderMode: 'clay',
      output: {width: 1920, height: 1080},
      aspectRatio: '9:16',
      clayColor: '#ABC',
      background: 'transparent',
      timeMs: 1234,
    })
  })

  test('cameraId/output/timeMs 非法值拒绝', () => {
    expectInvalid(() => validateStillExportArgs({cameraId: 1}))
    expectInvalid(() => validateStillExportArgs({cameraId: ''}))
    expectInvalid(() =>
      validateStillExportArgs({output: {width: 0, height: 100}}),
    )
    expectInvalid(() =>
      validateStillExportArgs({output: {width: 100.5, height: 100}}),
    )
    expectInvalid(() => validateStillExportArgs({timeMs: Number.NaN}))
  })

  test('renderMode/background/clayColor/aspectRatio 枚举校验', () => {
    expectInvalid(() => validateStillExportArgs({renderMode: 'wireframe'}))
    expectInvalid(() => validateStillExportArgs({background: 'blue'}))
    expectInvalid(() => validateStillExportArgs({clayColor: 'grey'}))
    expectInvalid(() => validateStillExportArgs({aspectRatio: '21:9'}))
  })

  test('未知参数和非对象参数拒绝', () => {
    expectInvalid(() => validateStillExportArgs([]))
    expectInvalid(() => validateStillExportArgs({unknown: true}), '未知参数')
  })
})

describe('startVideo 参数校验', () => {
  test('接受 range/fps 与渲染参数', () => {
    expect(
      validateVideoExportArgs({
        output: {width: 1280, height: 720},
        range: {startMs: 1000, endMs: 2500},
        fps: 24,
        renderMode: 'clay',
      }),
    ).toMatchObject({
      output: {width: 1280, height: 720},
      range: {startMs: 1000, endMs: 2500},
      fps: 24,
      renderMode: 'clay',
    })
  })

  test('fps 边界与 range 顺序', () => {
    for (const fps of [0, 61, 30.5, Number.NaN]) {
      expectInvalid(() => validateVideoExportArgs({fps}))
    }
    expectInvalid(() =>
      validateVideoExportArgs({range: {startMs: 100, endMs: 100}}),
    )
    expectInvalid(() =>
      validateVideoExportArgs({range: {startMs: -1, endMs: 100}}),
    )
  })

  test('transparent 仅 still 支持', () => {
    expectInvalid(
      () => validateVideoExportArgs({background: 'transparent'}),
      'captureStill',
    )
  })
})

describe('尺寸/帧规划/白模默认值', () => {
  test('output 优先于 aspectRatio;缺省用 canvas', () => {
    expect(
      resolveOutputSize(
        {output: {width: 333, height: 777}, aspectRatio: '16:9'},
        {width: 1000, height: 500},
      ),
    ).toEqual({width: 333, height: 777})
    expect(resolveOutputSize({}, {width: 1000, height: 500})).toEqual({
      width: 1000,
      height: 500,
    })
  })

  test('aspectRatio 完整装入当前 canvas', () => {
    expect(
      resolveOutputSize({aspectRatio: '9:16'}, {width: 1000, height: 500}),
    ).toEqual({width: 281, height: 500})
    expect(
      resolveOutputSize({aspectRatio: '16:9'}, {width: 1000, height: 500}),
    ).toEqual({width: 889, height: 500})
  })

  test('clay 默认中性背景、默认灰与颜色规范化', () => {
    expect(
      resolveRenderOptions({renderMode: 'clay'}, {width: 100, height: 100}),
    ).toMatchObject({
      renderMode: 'clay',
      background: 'neutral',
      clayColor: '#D8D8D8',
    })
    expect(normalizeClayColor('#abc')).toBe('#AABBCC')
  })

  test('帧数、range 裁剪与时间戳严格递增', () => {
    const plan = planVideoFrames({startMs: 250, endMs: 1250}, 30)
    expect(plan.frameCount).toBe(30)
    expect(plan.durationMs).toBe(1000)
    expect(plan.timesMs[0]).toBe(250)
    expect(plan.timesMs.at(-1)).toBeCloseTo(250 + (29 * 1000) / 30)
    for (let i = 1; i < plan.timestampsUs.length; i++) {
      expect(plan.timestampsUs[i]).toBeGreaterThan(plan.timestampsUs[i - 1]!)
      expect(plan.timestampsUs[i]).toBe(Math.round((i * 1_000_000) / 30))
    }
  })

  test('至少 1 帧;still 时间 clamp 到边界', () => {
    expect(planVideoFrames({startMs: 0, endMs: 1}, 30).frameCount).toBe(1)
    expect(clampStillTime(-10, 5000)).toBe(0)
    expect(clampStillTime(9000, 5000)).toBe(5000)
    expect(clampStillTime(1234.5, 5000)).toBe(1234.5)
  })
})
