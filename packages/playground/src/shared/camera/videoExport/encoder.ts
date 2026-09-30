/**
 * 视频编码器:把 canvas 画面流转成数据块序列。
 * 一期实现是 MediaRecorder 实时编码(边播边录);以后换 WebCodecs
 * 离线编码(逐帧喂画面、可控码率、产出 mp4)时实现同一个接口,
 * 导出流程和 ExportSink 都不用动。
 */
export interface VideoEncoder {
  /** 实际使用的 MIME(由浏览器能力决定) */
  readonly mimeType: string
  /** 每产出一个数据块回调一次;保证按顺序,且 stop()  resolve 前全部发完 */
  onChunk: ((chunk: Uint8Array) => void) | null
  start(): void
  /** 停止编码;resolve 时最后一个块已经通过 onChunk 发出 */
  stop(): Promise<void>
}

/** 按偏好顺序给出浏览器支持的容器/编码;一期优先 webm/mp4 都行 */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const

/** 选出第一个受支持的 MIME;都不支持返回 undefined(纯函数,可测) */
export function pickMimeType(
  isSupported: (mimeType: string) => boolean,
): string | undefined {
  return MIME_CANDIDATES.find((t) => isSupported(t))
}

/**  MIME → 文件扩展名(纯函数,可测) */
export function extForMime(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * MediaRecorder 实时编码器:canvas.captureStream() 的画面流边播边编。
 * 返回 undefined = 浏览器连一种支持的格式都没有(极少见)。
 */
export function createMediaRecorderEncoder(
  stream: MediaStream,
  options: {videoBitsPerSecond?: number; timesliceMs?: number} = {},
): VideoEncoder | undefined {
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) return undefined
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond ?? 12_000_000,
  })
  // dataavailable 的 Blob 转字节是异步的,stop 的 onstop 可能先 resolve;
  // 用链条把所有转换串起来,stop() 等链条清空才算完,保证块不丢不乱序
  let chunkChain = Promise.resolve()
  const encoder: VideoEncoder = {
    mimeType,
    onChunk: null,
    start() {
      recorder.start(options.timesliceMs ?? 1000)
    },
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          chunkChain.then(() => resolve())
        }
        recorder.stop()
      })
    },
  }
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    chunkChain = chunkChain.then(async () => {
      const buf = await event.data.arrayBuffer()
      encoder.onChunk?.(new Uint8Array(buf))
    })
  }
  return encoder
}
