/**
 * 视频编码路径(2026-11-14,Previs Capture):
 *
 * 1. 主路径:WebCodecs VideoEncoder(H.264/AVC)+ 本包 mp4Muxer;
 * 2. 显式降级:仅当 VideoEncoder / H.264 配置不可用时,才用
 *    MediaRecorder 录制,并如实返回实际容器/编码名。
 *
 * 不引入 Node-only 依赖;WebCodecs 输出样本在本包装配为普通 MP4。
 */
import {AgentApiError} from '../agent/errors'
import {pickMimeType} from './encoder'
import {muxH264Mp4, type Mp4Sample} from './mp4Muxer'
import {
  createMediaRecorderCanvas,
  createVideoFrameCanvas,
  drawPixels,
} from './sceneCapture'

export type VideoEncodingResult = {
  data: Uint8Array
  mimeType: string
  codec: string
  encoding: 'webcodecs' | 'mediarecorder'
}

const H264_CODECS = ['avc1.640028', 'avc1.4D4028', 'avc1.42E028'] as const

export function bitrateForSize(width: number, height: number): number {
  const pixels = width * height
  if (pixels >= 1920 * 1080) return 12_000_000
  if (pixels >= 1280 * 720) return 6_000_000
  return 4_000_000
}

function h264Config(
  width: number,
  height: number,
  fps: number,
  codec: string,
): VideoEncoderConfig {
  return {
    codec,
    width,
    height,
    framerate: fps,
    bitrate: bitrateForSize(width, height),
    latencyMode: 'quality',
    avc: {format: 'avc'},
  }
}

/** 选出浏览器当前能配置的 H.264 档位;不支持返回 null */
export async function chooseH264Config(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig | null> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoEncoder.isConfigSupported !== 'function'
  ) {
    return null
  }
  for (const codec of H264_CODECS) {
    const config = h264Config(width, height, fps, codec)
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) return support.config ?? config
    } catch {
      // 继续试下一档;全部失败 = H.264 不可用
    }
  }
  return null
}

function asBytes(
  source: AllowSharedBufferSource | undefined,
): Uint8Array | null {
  if (!source) return null
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  }
  return null
}

/**
 * WebCodecs H.264 writer。输入逐帧 RGBA8,输出完整 MP4 字节。
 * 每次 addFrame 都会关闭 VideoFrame;finish/abort 都会关闭 encoder。
 */
export class WebCodecsH264Writer {
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement
  private readonly samples: Mp4Sample[] = []
  private description: Uint8Array | null = null
  private encoderError: Error | null = null
  private closed = false

  private constructor(
    private readonly encoder: VideoEncoder,
    private readonly config: VideoEncoderConfig,
    readonly width: number,
    readonly height: number,
    private readonly fps: number,
  ) {
    this.canvas = createVideoFrameCanvas(width, height)
  }

  private handleOutput(
    chunk: EncodedVideoChunk,
    metadata?: EncodedVideoChunkMetadata,
  ): void {
    const bytes = new Uint8Array(chunk.byteLength)
    chunk.copyTo(bytes)
    const decoderConfig = metadata?.decoderConfig
    if (!this.description && decoderConfig?.description) {
      this.description = asBytes(decoderConfig.description)
    }
    this.samples.push({
      data: bytes,
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? Math.round(1_000_000 / this.fps),
      isKey: chunk.type === 'key',
    })
  }

  private handleError(error: DOMException): void {
    this.encoderError =
      error instanceof Error ? error : new Error(String(error))
  }

  static async create(args: {
    width: number
    height: number
    fps: number
  }): Promise<WebCodecsH264Writer | null> {
    const config = await chooseH264Config(args.width, args.height, args.fps)
    if (!config) return null
    let encoder: VideoEncoder | undefined
    try {
      let writer: WebCodecsH264Writer | undefined
      encoder = new VideoEncoder({
        output: (chunk, metadata) => writer?.handleOutput(chunk, metadata),
        error: (error) => writer?.handleError(error),
      })
      writer = new WebCodecsH264Writer(
        encoder,
        config,
        args.width,
        args.height,
        args.fps,
      )
      encoder.configure(config)
      // 预检 canvas → VideoFrame:部分平台有 VideoEncoder 但不接受
      // OffscreenCanvas 作为帧源,提前失败才能显式降级而不是录到一半崩。
      const probe = new VideoFrame(writer.canvas as CanvasImageSource, {
        timestamp: 0,
      })
      probe.close()
      return writer
    } catch {
      try {
        encoder?.close()
      } catch {
        // 已关闭/配置失败
      }
      return null
    }
  }

  get codec(): string {
    return this.config.codec
  }

  async addFrame(
    pixels: Uint8Array,
    timestampUs: number,
    durationUs: number,
    keyFrame: boolean,
  ): Promise<void> {
    if (this.closed) {
      throw new AgentApiError('INVALID_STATE', 'WebCodecs 编码器已关闭')
    }
    if (this.encoderError) throw this.encoderError
    drawPixels(this.canvas, pixels, this.width, this.height)
    const frame = new VideoFrame(this.canvas as CanvasImageSource, {
      timestamp: timestampUs,
      duration: durationUs,
    })
    try {
      this.encoder.encode(frame, {keyFrame})
    } finally {
      frame.close()
    }
    // 给编码器施加有界背压,避免高分辨率长片把队列撑爆内存
    while (this.encoder.encodeQueueSize > 8) {
      if (this.encoderError) throw this.encoderError
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  async finish(): Promise<VideoEncodingResult> {
    if (this.closed) {
      throw new AgentApiError('INVALID_STATE', 'WebCodecs 编码器已关闭')
    }
    this.closed = true
    try {
      await this.encoder.flush()
    } finally {
      this.encoder.close()
    }
    if (this.encoderError) throw this.encoderError
    if (!this.description) {
      throw new AgentApiError(
        'INTERNAL_ERROR',
        'H.264 编码器未返回 avcC decoder description',
      )
    }
    const data = muxH264Mp4({
      width: this.width,
      height: this.height,
      fps: this.fps,
      samples: this.samples,
      avcC: this.description,
    })
    return {
      data,
      mimeType: 'video/mp4',
      codec: this.config.codec,
      encoding: 'webcodecs',
    }
  }

  abort(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.encoder.close()
    } catch {
      // 已关闭/不可关闭都视为成功中止
    }
    this.samples.length = 0
  }
}

function codecFromMime(mimeType: string): string {
  if (mimeType.includes('vp9')) return 'vp9'
  if (mimeType.includes('vp8')) return 'vp8'
  if (mimeType.includes('avc') || mimeType.includes('mp4')) return 'avc1'
  return mimeType
}

/**
 * MediaRecorder 显式降级 writer。仅用于 WebCodecs/H.264 缺失的平台。
 * 该路径受实时录制能力影响,结果会如实标记 encoding='mediarecorder'。
 */
export class MediaRecorderVideoWriter {
  private readonly canvas: HTMLCanvasElement
  private readonly recorder: MediaRecorder
  private readonly track: MediaStreamTrack & {requestFrame?: () => void}
  private readonly chunks: Blob[] = []
  private readonly stopPromise: Promise<void>
  private stopped = false

  private constructor(
    canvas: HTMLCanvasElement,
    recorder: MediaRecorder,
    track: MediaStreamTrack & {requestFrame?: () => void},
    readonly mimeType: string,
    readonly fps: number,
  ) {
    this.canvas = canvas
    this.recorder = recorder
    this.track = track
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.stopPromise = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = (event) =>
        reject(
          (event as ErrorEvent).error ?? new Error('MediaRecorder 录制失败'),
        )
    })
  }

  static async create(args: {
    width: number
    height: number
    fps: number
  }): Promise<MediaRecorderVideoWriter | null> {
    if (typeof MediaRecorder === 'undefined') return null
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) return null
    try {
      const canvas = createMediaRecorderCanvas(args.width, args.height)
      const captureStream = canvas.captureStream
      if (typeof captureStream !== 'function') return null
      const stream = captureStream.call(canvas, 0)
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrateForSize(args.width, args.height),
      })
      const writer = new MediaRecorderVideoWriter(
        canvas,
        recorder,
        stream.getVideoTracks()[0]!,
        mimeType,
        args.fps,
      )
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('start', () => resolve(), {once: true})
        recorder.addEventListener(
          'error',
          (event) =>
            reject(
              (event as ErrorEvent).error ??
                new Error('MediaRecorder 启动失败'),
            ),
          {once: true},
        )
        recorder.start(1000)
      })
      return writer
    } catch {
      return null
    }
  }

  async addFrame(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): Promise<void> {
    drawPixels(this.canvas, pixels, width, height)
    this.track.requestFrame?.()
    // 降级路径按真实帧间隔给录制器采样窗口;机器慢时会如实表现为
    // MediaRecorder 的限制,不会伪称离线确定帧。
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, 1000 / this.fps)),
    )
  }

  async finish(): Promise<VideoEncodingResult> {
    if (!this.stopped) {
      this.stopped = true
      this.recorder.stop()
    }
    await this.stopPromise
    this.track.stop()
    const blob = new Blob(this.chunks as BlobPart[], {type: this.mimeType})
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || this.mimeType,
      codec: codecFromMime(this.mimeType),
      encoding: 'mediarecorder',
    }
  }

  abort(): void {
    if (this.stopped) return
    this.stopped = true
    this.chunks.length = 0
    try {
      this.recorder.stop()
    } catch {
      // 已停止
    }
    this.track.stop()
  }
}
