import type {ISheet} from '@toy-box/core'
import {val} from '@toy-box/dataverse'
import {createMediaRecorderEncoder, extForMime} from './encoder'
import type {ExportSink} from './sinks'

export interface ShotExportHandle {
  /** 提前结束并保存已录内容 */
  finishEarly(): void
  /** 取消录制,丢弃已录内容 */
  abort(): void
  /** 正常结束 resolve;出错或取消 reject(Error) */
  done: Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 导出镜头视频:序列从头播到尾,canvas 画面实时编码,数据块流式写给 sink。
 * 调用前先把画面切到镜头视角(录的就是 canvas 当前内容)。
 *
 * 一期限制:实时录制——序列多长就录多久,播放掉帧录出来也掉帧;
 * 容器格式看浏览器(webm 为主)。离线逐帧渲染 + mp4 留作以后升级。
 */
export function startShotExport(args: {
  canvas: HTMLCanvasElement
  sheet: ISheet
  sink: ExportSink
  onError?: (message: string) => void
}): ShotExportHandle | undefined {
  const {canvas, sheet, sink, onError} = args
  // 30fps 是上限:frameloop="demand" 下只有画面真变才有帧,不会硬塞重复帧
  const stream = canvas.captureStream(30)
  const encoder = createMediaRecorderEncoder(stream)
  if (!encoder) {
    onError?.('当前浏览器不支持视频录制(MediaRecorder 无可用格式)')
    return undefined
  }

  const sequence = sheet.sequence
  const length = val(sequence.pointer.length)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
  const suggestedName = `镜头-${stamp}.${extForMime(encoder.mimeType)}`

  let aborted = false
  const done = (async () => {
    try {
      // 另存为会在这里弹系统对话框;用户点取消 = AbortError,安静结束
      await sink.start({mimeType: encoder.mimeType, suggestedName})
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      throw err
    }
    // sink.write 串行化:MediaRecorder 的块按序到达,写也按序落盘
    let writeChain = Promise.resolve()
    encoder.onChunk = (chunk) => {
      writeChain = writeChain.then(() => sink.write(chunk))
    }
    encoder.start()
    await sleep(150) // 编码器热身,开头少丢帧
    try {
      sequence.position = 0
      // play 全程 resolve true;pause() 打断 resolve false,两条路都走到收尾
      await sequence.play({iterationCount: 1, range: [0, length]})
      await sleep(120) // 末尾帧冲刷
    } finally {
      await encoder.stop()
      await writeChain
    }
    if (aborted) {
      await sink.abort()
      return
    }
    await sink.finish()
  })().catch((err) => {
    sink.abort().catch(() => {})
    onError?.(`导出失败:${err?.message ?? err}`)
    throw err
  })

  return {
    finishEarly() {
      sequence.pause()
    },
    abort() {
      aborted = true
      sequence.pause()
    },
    done,
  }
}
