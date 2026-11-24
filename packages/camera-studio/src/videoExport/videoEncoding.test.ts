jest.doMock('./sceneCapture', () => ({
  createVideoFrameCanvas: () => ({}),
  drawPixels: () => {},
}))

const {bitrateForSize, chooseH264Config, WebCodecsH264Writer} =
  require('./videoEncoding') as typeof import('./videoEncoding')

const browser = globalThis as {VideoFrame?: unknown; VideoEncoder?: unknown}

function mockEncoder(failOnFlush?: 'first' | 'export') {
  const failure = new Error('H.264 initialization failed')
  let flushCount = 0
  browser.VideoFrame = class {
    readonly timestamp: number
    constructor(_source: unknown, options: {timestamp: number}) {
      this.timestamp = options.timestamp
    }
    close() {}
  }
  browser.VideoEncoder = class {
    static async isConfigSupported(config: VideoEncoderConfig) {
      return {supported: true, config}
    }
    state = 'unconfigured'
    encodeQueueSize = 0
    private pending: number[] = []

    constructor(private readonly callbacks: VideoEncoderInit) {}

    configure() {
      this.state = 'configured'
    }
    encode(frame: {timestamp: number}) {
      this.pending.push(frame.timestamp)
    }
    async flush() {
      flushCount++
      if (
        (failOnFlush === 'first' && flushCount === 1) ||
        (failOnFlush === 'export' && this.pending.includes(1_000))
      ) {
        this.state = 'closed'
        this.callbacks.error(failure as DOMException)
        throw new Error('flush rejected')
      }
      for (const timestamp of this.pending) {
        const chunk = {
          byteLength: 1,
          timestamp,
          duration: 33_333,
          type: 'key',
          copyTo: (bytes: Uint8Array) => {
            bytes[0] = 0x65
          },
        } as EncodedVideoChunk
        this.callbacks.output(chunk, {
          decoderConfig: {
            codec: 'avc1.640028',
            description: new Uint8Array([
              1, 100, 0, 40, 255, 225, 0, 0, 0, 1, 0, 0,
            ]),
          },
        })
      }
      this.pending = []
    }
    close() {
      if (this.state === 'closed')
        throw new Error('Cannot close a closed codec')
      this.state = 'closed'
    }
  }
  return failure
}

afterEach(() => {
  delete browser.VideoEncoder
  delete browser.VideoFrame
})

describe('chooseH264Config', () => {
  test('选择首个受支持的 H.264 档位', async () => {
    const isConfigSupported = jest.fn(async (config: VideoEncoderConfig) => ({
      supported: config.codec === 'avc1.4D4028',
      config,
    }))
    ;(globalThis as {VideoEncoder?: unknown}).VideoEncoder = class {
      static isConfigSupported = isConfigSupported
    }
    await expect(chooseH264Config(1280, 720, 30)).resolves.toMatchObject({
      codec: 'avc1.4D4028',
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 6_000_000,
    })
    expect(isConfigSupported).toHaveBeenCalledTimes(2)
  })

  test('无 WebCodecs / 全部不支持 → null,触发显式降级', async () => {
    await expect(chooseH264Config(640, 360, 24)).resolves.toBeNull()
    ;(globalThis as {VideoEncoder?: unknown}).VideoEncoder = class {
      static isConfigSupported = async () => ({supported: false})
    }
    await expect(chooseH264Config(640, 360, 24)).resolves.toBeNull()
  })

  test('码率按分辨率给出 1080p 12Mbps / 720p 6Mbps', () => {
    expect(bitrateForSize(1920, 1080)).toBe(12_000_000)
    expect(bitrateForSize(1280, 720)).toBe(6_000_000)
    expect(bitrateForSize(640, 360)).toBe(4_000_000)
  })
})

describe('WebCodecs H.264 writer', () => {
  const options = {width: 320, height: 180, fps: 30}

  test('an advertised codec that closes on its first encode falls back', async () => {
    mockEncoder('first')
    await expect(WebCodecsH264Writer.create(options)).resolves.toBeNull()
  })

  test('preserves the encoder error if a codec closes during final flush', async () => {
    const failure = mockEncoder('export')
    const writer = (await WebCodecsH264Writer.create(options))!
    await writer.addFrame(new Uint8Array(320 * 180 * 4), 1_000, 33_333, true)
    await expect(writer.finish()).rejects.toBe(failure)
  })

  test('the probe frame stays out of the exported MP4', async () => {
    mockEncoder()
    const writer = (await WebCodecsH264Writer.create(options))!
    await writer.addFrame(new Uint8Array(320 * 180 * 4), 0, 33_333, true)
    const {data} = await writer.finish()
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    // ftyp is followed by mdat. The MP4 contains only the one real encoded byte.
    expect(view.getUint32(view.getUint32(0))).toBe(9)
  })
})
