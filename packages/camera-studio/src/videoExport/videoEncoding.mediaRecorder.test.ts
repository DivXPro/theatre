/**
 * MediaRecorder 显式降级契约:仅当 WebCodecs/H.264 不可用时使用,
 * 结果必须如实标记 encoding='mediarecorder' 与实际容器/编码名。
 */
jest.doMock('./sceneCapture', () => ({
  drawPixels: () => FakeMediaRecorder.instance?.paint(),
  createVideoFrameCanvas: (width: number, height: number) => ({
    width,
    height,
  }),
  createMediaRecorderCanvas: (width: number, height: number) => {
    const track = {
      requestFrame: () => FakeMediaRecorder.instance?.requestFrame(),
      stop: jest.fn(),
    }
    return {
      width,
      height,
      captureStream: () => ({
        getVideoTracks: () => [track],
      }),
    }
  },
}))

afterEach(() => {
  delete (globalThis as {MediaRecorder?: unknown}).MediaRecorder
})

// jest-esbuild 不会像 babel-jest 那样提升 jest.mock,先 doMock 再 require。
const {MediaRecorderVideoWriter} =
  require('./videoEncoding') as typeof import('./videoEncoding')

type FakeRecorder = {
  mimeType: string
  ondataavailable: ((event: {data: Blob}) => void) | null
  onstop: (() => void) | null
  onerror: ((event: unknown) => void) | null
}

class FakeMediaRecorder extends EventTarget implements FakeRecorder {
  static isTypeSupported = (type: string) => type.startsWith('video/webm')
  static instance: FakeMediaRecorder | undefined

  ondataavailable: ((event: {data: Blob}) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  state = 'inactive'
  dropFrames = false
  dropData = false
  private frameRequested = false
  private captured = false

  constructor(
    readonly stream: unknown,
    readonly options: {mimeType: string},
  ) {
    super()
    this.mimeType = options.mimeType
    FakeMediaRecorder.instance = this
  }

  readonly mimeType: string

  start(): void {
    this.state = 'recording'
  }

  requestFrame(): void {
    this.frameRequested = true
  }

  paint(): void {
    if (
      this.state !== 'recording' ||
      !this.frameRequested ||
      this.captured ||
      this.dropFrames
    )
      return
    this.captured = true
    this.dispatchEvent(new Event('start'))
  }

  stop(): void {
    this.state = 'inactive'
    setTimeout(() => {
      this.ondataavailable?.({
        data: new Blob(this.captured && !this.dropData ? ['webm-bytes'] : [], {
          type: this.mimeType,
        }),
      })
      this.onstop?.()
    }, 0)
  }
}

describe('MediaRecorderVideoWriter', () => {
  beforeEach(() => {
    ;(globalThis as {MediaRecorder?: unknown}).MediaRecorder = FakeMediaRecorder
  })

  test('首帧触发 start 的浏览器可以导出非空视频', async () => {
    const writer = await Promise.race([
      MediaRecorderVideoWriter.create({width: 320, height: 180, fps: 60}),
      Promise.resolve(null),
    ])
    expect(writer).not.toBeNull()
    expect(FakeMediaRecorder.instance?.state).toBe('inactive')
    expect(writer!.mimeType).toBe('video/webm;codecs=vp9')

    await writer!.addFrame(new Uint8Array(320 * 180 * 4), 320, 180)

    const result = await writer!.finish()
    expect(result.encoding).toBe('mediarecorder')
    expect(result.mimeType).toBe('video/webm;codecs=vp9')
    expect(result.codec).toBe('vp9')
    expect(result.data.length).toBeGreaterThan(0)
  })

  test('等待首帧时取消会立即中止编码并释放视频轨', async () => {
    const writer = await MediaRecorderVideoWriter.create({
      width: 320,
      height: 180,
      fps: 60,
    })
    const recorder = FakeMediaRecorder.instance!
    const stream = recorder.stream as MediaStream
    recorder.dropFrames = true
    const frame = writer!.addFrame(new Uint8Array(320 * 180 * 4), 320, 180)
    writer!.abort()

    await expect(frame).rejects.toMatchObject({code: 'JOB_CANCELLED'})
    expect(stream.getVideoTracks()[0]!.stop).toHaveBeenCalledTimes(1)
    expect(recorder.state).toBe('inactive')
  })

  test('录制器未返回数据时导出报错', async () => {
    const writer = await MediaRecorderVideoWriter.create({
      width: 320,
      height: 180,
      fps: 60,
    })
    FakeMediaRecorder.instance!.dropData = true
    await writer!.addFrame(new Uint8Array(320 * 180 * 4), 320, 180)

    await expect(writer!.finish()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
  })
})
