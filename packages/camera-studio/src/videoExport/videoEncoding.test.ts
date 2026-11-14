import {bitrateForSize, chooseH264Config} from './videoEncoding'

afterEach(() => {
  delete (globalThis as {VideoEncoder?: unknown}).VideoEncoder
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
