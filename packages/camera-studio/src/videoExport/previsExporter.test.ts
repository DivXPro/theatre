/**
 * 导出核心编排契约:frameloop 协调、取消即时清理、提前停止时长、
 * 静帧时间 clamp。像素/编码细节由 sceneCapture / videoEncoding 单测覆盖,
 * 这里把两端替换为可观察的假实现。
 */
type MockState = {
  frameloop: 'always' | 'demand' | 'never'
  beginThrows: boolean
  restoreCalls: number
  rendererDisposeCalls: number
  writerAbortCalls: number
  addFrameCalls: number
  encoded: {
    data: Uint8Array
    mimeType: string
    codec: string
    encoding: 'webcodecs' | 'mediarecorder'
  }
}

const mockState: MockState = {
  frameloop: 'demand',
  beginThrows: false,
  restoreCalls: 0,
  rendererDisposeCalls: 0,
  writerAbortCalls: 0,
  addFrameCalls: 0,
  encoded: {
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'video/mp4',
    codec: 'avc1.640028',
    encoding: 'webcodecs',
  },
}

const tick = jest.fn()

jest.doMock('@dreamerbird/core', () => ({
  val: (value: unknown) => value,
}))
jest.doMock('@dreamerbird/core/coreTicker', () => ({
  getCoreTicker: () => ({tick}),
}))
jest.doMock('./sceneCapture', () => ({
  beginExportSceneState: jest.fn(() => {
    if (mockState.beginThrows) throw new Error('scene setup failed')
    return () => {
      mockState.restoreCalls += 1
    }
  }),
  ExportFrameRenderer: class {
    render() {
      return new Uint8Array(4)
    }
    dispose() {
      mockState.rendererDisposeCalls += 1
    }
  },
  encodePng: async () => new Blob(['png-bytes'], {type: 'image/png'}),
}))
jest.doMock('./videoEncoding', () => ({
  WebCodecsH264Writer: class {
    static async create() {
      return {
        addFrame: async () => {
          mockState.addFrameCalls += 1
        },
        finish: async () => mockState.encoded,
        abort: () => {
          mockState.writerAbortCalls += 1
        },
      }
    }
  },
  MediaRecorderVideoWriter: class {
    static async create() {
      return null
    }
  },
}))

const {startStillExport, startVideoExport} =
  require('./previsExporter') as typeof import('./previsExporter')

import type {ExportRenderContext} from './exportRenderContext'

function makeSequence(lengthSeconds = 2) {
  return {
    position: 0.5,
    pointer: {length: lengthSeconds, playing: false},
    pause: jest.fn(),
    play: jest.fn(async () => true),
  }
}

function makeContext() {
  const setFrameloop = jest.fn((mode: MockState['frameloop']) => {
    mockState.frameloop = mode
  })
  const invalidate = jest.fn()
  const advance = jest.fn()
  const context: ExportRenderContext = {
    renderer: {} as never,
    scene: {} as never,
    getCamera: () => ({}) as never,
    getCanvasSize: () => ({width: 640, height: 360}),
    getFrameloop: () => mockState.frameloop,
    setFrameloop,
    advance,
    invalidate,
  }
  return {context, setFrameloop, invalidate, advance}
}

function makeSink() {
  return {
    id: 'mock',
    label: 'mock',
    description: 'mock',
    available: () => true,
    start: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
    finish: jest.fn(async () => {}),
    abort: jest.fn(async () => {}),
  }
}

beforeEach(() => {
  mockState.frameloop = 'demand'
  mockState.beginThrows = false
  mockState.restoreCalls = 0
  mockState.rendererDisposeCalls = 0
  mockState.writerAbortCalls = 0
  mockState.addFrameCalls = 0
  tick.mockClear()
})

describe('startVideoExport', () => {
  test('导出期切到 frameloop=never,完成后恢复并还原播放头', async () => {
    const sequence = makeSequence()
    const {context, setFrameloop, invalidate, advance} = makeContext()

    const result = await startVideoExport({
      context,
      sequence: sequence as never,
      camera: {} as never,
      options: {
        width: 640,
        height: 360,
        renderMode: 'clay',
        clayColor: '#D8D8D8',
        background: 'neutral',
      },
      range: {startMs: 0, endMs: 100},
      fps: 30,
    }).done

    expect(setFrameloop.mock.calls.map((c) => c[0])).toEqual([
      'never',
      'demand',
    ])
    expect(invalidate).toHaveBeenCalled()
    expect(advance).toHaveBeenCalledTimes(3)
    expect(sequence.position).toBe(0.5)
    expect(mockState.restoreCalls).toBe(1)
    expect(mockState.rendererDisposeCalls).toBe(1)
    expect(result.durationMs).toBe(100)
    expect(result.encoding).toBe('webcodecs')
  })

  test('jobs.cancel 立刻恢复 frameloop/场景,且不产出部分文件', async () => {
    const sequence = makeSequence()
    const {context, setFrameloop} = makeContext()
    const sink = makeSink()
    const handleRef: {
      current?: ReturnType<typeof startVideoExport>
    } = {}

    const task = startVideoExport({
      context,
      sequence: sequence as never,
      camera: {} as never,
      options: {
        width: 640,
        height: 360,
        renderMode: 'clay',
        clayColor: '#D8D8D8',
        background: 'neutral',
      },
      range: {startMs: 0, endMs: 10_000},
      fps: 30,
      sink: sink as never,
      onProgress: (progress) => {
        if (progress > 0) handleRef.current?.abort()
      },
    })
    handleRef.current = task

    await expect(task.done).rejects.toMatchObject({code: 'JOB_CANCELLED'})
    expect(setFrameloop.mock.calls.map((c) => c[0])).toEqual([
      'never',
      'demand',
    ])
    expect(mockState.restoreCalls).toBe(1)
    expect(mockState.writerAbortCalls).toBe(1)
    expect(mockState.rendererDisposeCalls).toBe(1)
    expect(sequence.position).toBe(0.5)
    expect(sink.write).not.toHaveBeenCalled()
    expect(sink.finish).not.toHaveBeenCalled()
    expect(sink.abort).toHaveBeenCalled()
  })

  test('提前停止时 durationMs 报告实际编码帧时长', async () => {
    const sequence = makeSequence()
    const {context} = makeContext()
    const handleRef: {
      current?: ReturnType<typeof startVideoExport>
    } = {}

    const task = startVideoExport({
      context,
      sequence: sequence as never,
      camera: {} as never,
      options: {
        width: 640,
        height: 360,
        renderMode: 'clay',
        clayColor: '#D8D8D8',
        background: 'neutral',
      },
      range: {startMs: 0, endMs: 10_000},
      fps: 30,
      onProgress: (progress) => {
        if (progress > 0) handleRef.current?.finishEarly()
      },
    })
    handleRef.current = task

    const result = await task.done
    expect(mockState.addFrameCalls).toBe(1)
    expect(result.durationMs).toBe(33)
    expect(result.range).toEqual({startMs: 0, endMs: 10_000})
  })

  test('成功完成时 finish sink,不能在收尾阶段 abort 掉成品', async () => {
    const sequence = makeSequence()
    const {context} = makeContext()
    const sink = makeSink()

    await startVideoExport({
      context,
      sequence: sequence as never,
      camera: {} as never,
      options: {
        width: 640,
        height: 360,
        renderMode: 'clay',
        clayColor: '#D8D8D8',
        background: 'neutral',
      },
      range: {startMs: 0, endMs: 100},
      fps: 30,
      sink: sink as never,
    }).done

    expect(sink.start).toHaveBeenCalledTimes(1)
    expect(sink.write).toHaveBeenCalledTimes(1)
    expect(sink.finish).toHaveBeenCalledTimes(1)
    expect(sink.abort).not.toHaveBeenCalled()
  })

  test('场景临时状态建立失败时恢复 sequence 与 frameloop', async () => {
    mockState.beginThrows = true
    const sequence = makeSequence()
    const {context, setFrameloop} = makeContext()

    await expect(
      startVideoExport({
        context,
        sequence: sequence as never,
        camera: {} as never,
        options: {
          width: 640,
          height: 360,
          renderMode: 'clay',
          clayColor: '#D8D8D8',
          background: 'neutral',
        },
        range: {startMs: 0, endMs: 100},
        fps: 30,
      }).done,
    ).rejects.toThrow('scene setup failed')

    expect(sequence.position).toBe(0.5)
    expect(setFrameloop.mock.calls.map((c) => c[0])).toEqual([
      'never',
      'demand',
    ])
    expect(mockState.addFrameCalls).toBe(0)
  })
})

describe('startStillExport', () => {
  test('时间 clamp、frameloop 恢复与 PNG 元数据', async () => {
    const sequence = makeSequence(2)
    const {context, setFrameloop} = makeContext()

    const result = await startStillExport({
      context,
      sequence: sequence as never,
      camera: {} as never,
      options: {
        width: 320,
        height: 180,
        renderMode: 'clay',
        clayColor: '#D8D8D8',
        background: 'neutral',
      },
      timeMs: 99_999,
    }).done

    expect(result.timeMs).toBe(2000)
    expect(result.width).toBe(320)
    expect(result.height).toBe(180)
    expect(result.mimeType).toBe('image/png')
    expect(result.renderMode).toBe('clay')
    expect(setFrameloop.mock.calls.map((c) => c[0])).toEqual([
      'never',
      'demand',
    ])
    expect(sequence.position).toBe(0.5)
    expect(mockState.restoreCalls).toBe(1)
    expect(mockState.rendererDisposeCalls).toBe(1)
  })
})
