/**
 * MediaRecorder 显式降级契约:仅当 WebCodecs/H.264 不可用时使用,
 * 结果必须如实标记 encoding='mediarecorder' 与实际容器/编码名。
 */
jest.doMock('./sceneCapture', () => ({
  drawPixels: jest.fn(),
  createVideoFrameCanvas: (width: number, height: number) => ({
    width,
    height,
  }),
  createMediaRecorderCanvas: (width: number, height: number) => {
    const track = {requestFrame: jest.fn(), stop: jest.fn()}
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

class FakeMediaRecorder implements FakeRecorder {
  static isTypeSupported = (type: string) => type.startsWith('video/webm')
  static instance: FakeMediaRecorder | undefined

  ondataavailable: ((event: {data: Blob}) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(
    readonly stream: unknown,
    readonly options: {mimeType: string},
  ) {
    this.mimeType = options.mimeType
    FakeMediaRecorder.instance = this
  }

  readonly mimeType: string

  addEventListener(name: string, listener: () => void): void {
    if (name === 'start') setTimeout(listener, 0)
  }

  start(): void {}

  stop(): void {
    setTimeout(() => {
      this.ondataavailable?.({
        data: new Blob(['webm-bytes'], {type: this.mimeType}),
      })
      this.onstop?.()
    }, 0)
  }
}

describe('MediaRecorderVideoWriter', () => {
  test('WebCodecs 缺失时产出如实标记的 mediarecorder 结果', async () => {
    ;(globalThis as {MediaRecorder?: unknown}).MediaRecorder = FakeMediaRecorder

    const writer = await MediaRecorderVideoWriter.create({
      width: 320,
      height: 180,
      fps: 60,
    })
    expect(writer).not.toBeNull()
    expect(writer!.mimeType).toBe('video/webm;codecs=vp9')

    await writer!.addFrame(new Uint8Array(320 * 180 * 4), 320, 180)

    const result = await writer!.finish()
    expect(result.encoding).toBe('mediarecorder')
    expect(result.mimeType).toBe('video/webm;codecs=vp9')
    expect(result.codec).toBe('vp9')
    expect(result.data.length).toBeGreaterThan(0)
  })
})
