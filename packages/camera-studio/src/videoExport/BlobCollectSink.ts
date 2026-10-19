/**
 * BlobCollectSink(2026-10-17,Task 13):内存收集导出目标——Agent 视频导出
 * (exports.startVideo)的默认 sink。编码器产出的块按序攒在内存,finish
 * 后由 blob() 整包取走;不触发浏览器下载,不进 listSinks 的 UI 菜单。
 *
 * 生命周期约束:abort 后 blob() 抛 INVALID_STATE、后续 write 拒绝;
 * 重复 start 清空旧块(同一个 sink 可随新任务复用)。
 */
import {AgentApiError} from '../agent/errors'
import type {ExportSink, ExportSinkMeta} from './sinks'

export class BlobCollectSink implements ExportSink {
  readonly id = 'collect'
  readonly label = '收集到内存'
  readonly description = 'Agent 导出用:录制完成后整包取走,不触发下载'
  private chunks: Uint8Array[] = []
  private meta: ExportSinkMeta | undefined
  private aborted = false

  available(): boolean {
    return true
  }

  async start(meta: ExportSinkMeta): Promise<void> {
    this.chunks = []
    this.meta = meta
    this.aborted = false
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.aborted) {
      throw new AgentApiError('INVALID_STATE', '导出已取消,拒绝继续写入')
    }
    this.chunks.push(chunk)
  }

  /** 不落盘、不下载:收尾什么都不做,文件由 blob() 取 */
  async finish(): Promise<void> {}

  async abort(): Promise<void> {
    this.aborted = true
    this.chunks = []
  }

  /**
   * 收集到的文件(start 时已收到的 MIME 为容器类型)。
   * 未 start 或已 abort 抛 INVALID_STATE —— 没有可交付的产出。
   */
  blob(): Blob {
    if (this.aborted || !this.meta) {
      throw new AgentApiError(
        'INVALID_STATE',
        '导出已取消或尚未开始,无可交付文件',
      )
    }
    return new Blob(this.chunks as BlobPart[], {type: this.meta.mimeType})
  }

  /** start 时编码器给出的建议文件名;未 start 为 undefined */
  get fileName(): string | undefined {
    return this.meta?.suggestedName
  }

  /** start 时的容器 MIME;未 start 为 undefined */
  get mimeType(): string | undefined {
    return this.meta?.mimeType
  }
}
