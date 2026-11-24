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
      // isConfigSupported 和 configure 都可能先成功，硬件初始化失败
      // 要等首帧才异步上报。实际试编一帧后再决定是否走 WebCodecs。
      const probe = new VideoFrame(writer.canvas as CanvasImageSource, {
        timestamp: 0,
        duration: Math.round(1_000_000 / args.fps),
      })
      try {
        encoder.encode(probe, {keyFrame: true})
      } finally {
        probe.close()
      }
      await waitForEncoding(writer.flushEncoder(), 'WebCodecs 等待探测帧超时')
      if (!writer.description || !writer.samples.length) {
        writer.abort()
        return null
      }
      // 保留编码配置，正式视频从自己的首帧开始。
      writer.samples.length = 0
      return writer
    } catch {
      try {
        if (encoder && encoder.state !== 'closed') encoder.close()
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

  private async flushEncoder(): Promise<void> {
    try {
      await this.encoder.flush()
    } catch (error) {
      throw this.encoderError ?? error
    }
    if (this.encoderError) throw this.encoderError
  }

  async finish(): Promise<VideoEncodingResult> {
    if (this.closed) {
      throw new AgentApiError('INVALID_STATE', 'WebCodecs 编码器已关闭')
    }
    this.closed = true
    try {
      await this.flushEncoder()
    } finally {
      if (this.encoder.state !== 'closed') this.encoder.close()
    }
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

async function waitForEncoding(
  event: Promise<void>,
  timeoutMessage: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      event,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AgentApiError('INTERNAL_ERROR', timeoutMessage)),
          10_000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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
  private rejectStop!: (error: Error) => void
  private started = false
  private aborted = false

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
      if (!this.aborted && event.data.size > 0) this.chunks.push(event.data)
    }
    this.stopPromise = new Promise<void>((resolve, reject) => {
      this.rejectStop = reject
      recorder.onstop = () => resolve()
      recorder.onerror = (event) =>
        reject(
          (event as ErrorEvent).error ?? new Error('MediaRecorder 录制失败'),
        )
    })
    void this.stopPromise.catch(() => {})
  }

  static async create(args: {
    width: number
    height: number
    fps: number
  }): Promise<MediaRecorderVideoWriter | null> {
    if (typeof MediaRecorder === 'undefined') return null
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) return null
    let stream: MediaStream | undefined
    try {
      const canvas = createMediaRecorderCanvas(args.width, args.height)
      const captureStream = canvas.captureStream
      if (typeof captureStream !== 'function') return null
      stream = captureStream.call(canvas, 0)
      const track = stream.getVideoTracks()[0] as
        | (MediaStreamTrack & {requestFrame?: () => void})
        | undefined
      if (!track?.requestFrame) {
        track?.stop()
        stream = captureStream.call(canvas)
      }
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) return null
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrateForSize(args.width, args.height),
      })
      return new MediaRecorderVideoWriter(
        canvas,
        recorder,
        videoTrack,
        mimeType,
        args.fps,
      )
    } catch {
      stream?.getVideoTracks().forEach((track) => track.stop())
      return null
    }
  }

  async addFrame(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): Promise<void> {
    if (this.aborted) {
      throw new AgentApiError('JOB_CANCELLED', '预演导出已取消')
    }
    let start: Promise<void> | undefined
    if (!this.started) {
      start = new Promise<void>((resolve) => {
        this.recorder.addEventListener('start', () => resolve(), {once: true})
      })
      this.recorder.start(1000)
      this.started = true
    }
    this.track.requestFrame?.()
    drawPixels(this.canvas, pixels, width, height)
    if (start) {
      await waitForEncoding(
        Promise.race([
          start,
          this.stopPromise.then(() => {
            throw new AgentApiError(
              'INTERNAL_ERROR',
              'MediaRecorder 未能录制首帧',
            )
          }),
        ]),
        'MediaRecorder 等待首帧超时',
      )
    }
    // 降级路径按真实帧间隔给录制器采样窗口;机器慢时会如实表现为
    // MediaRecorder 的限制,不会伪称离线确定帧。
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, 1000 / this.fps)),
    )
  }

  async finish(): Promise<VideoEncodingResult> {
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop()
      await waitForEncoding(this.stopPromise, 'MediaRecorder 等待视频完成超时')
    } finally {
      this.track.stop()
    }
    const blob = new Blob(this.chunks as BlobPart[], {type: this.mimeType})
    if (!blob.size) {
      throw new AgentApiError('INTERNAL_ERROR', 'MediaRecorder 未产出视频数据')
    }
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || this.mimeType,
      codec: codecFromMime(this.mimeType),
      encoding: 'mediarecorder',
    }
  }

  abort(): void {
    if (this.aborted) return
    this.aborted = true
    this.chunks.length = 0
    this.rejectStop(new AgentApiError('JOB_CANCELLED', '预演导出已取消'))
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // 已停止
    }
    this.track.stop()
  }
}
