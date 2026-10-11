/**
 * 导出目标(ExportSink):编码器产出的数据块写到哪儿。
 * 一期两个本地目标:另存为(流式写盘)和直接下载(攒 Blob);
 * 以后接存储 API(分片上传、finish 提交合并)就是再实现一个
 * 同样的接口,导出菜单自动多一项,编码器和导出流程不动。
 */
export interface ExportSinkMeta {
  mimeType: string
  suggestedName: string
}

export interface ExportSink {
  readonly id: string
  /** 菜单里显示的名字 */
  readonly label: string
  /** 菜单里的一行说明 */
  readonly description: string
  /** 当前环境是否可用(另存为需要 File System Access API) */
  available(): boolean
  /** 另存为会在这里弹系统对话框,所以 start 必须在用户点击的调用栈里调 */
  start(meta: ExportSinkMeta): Promise<void>
  /** 流式写一块;调用方保证顺序、不并发 */
  write(chunk: Uint8Array): Promise<void>
  /** 全部写完,落盘收尾 */
  finish(): Promise<void>
  /** 中途取消:丢弃已收到的内容,不留半成品 */
  abort(): Promise<void>
}

/** 直接下载:块攒在内存,结束后拼 Blob 触发浏览器下载(所有浏览器可用) */
export class BlobDownloadSink implements ExportSink {
  readonly id = 'download'
  readonly label = '直接下载'
  readonly description = '录制完成后存到浏览器的下载目录'
  private chunks: Uint8Array[] = []
  private meta: ExportSinkMeta | undefined

  available(): boolean {
    return true
  }

  async start(meta: ExportSinkMeta): Promise<void> {
    this.chunks = []
    this.meta = meta
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk)
  }

  async finish(): Promise<void> {
    const blob = new Blob(this.chunks as BlobPart[], {
      type: this.meta?.mimeType,
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = this.meta?.suggestedName ?? 'video.webm'
    a.click()
    //  revoke 得太早有的浏览器还没开始下载,给一拍
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.chunks = []
  }

  async abort(): Promise<void> {
    this.chunks = []
  }
}

/** 另存为:File System Access API 流式写盘,录制前用户选好位置(Chrome/Edge) */
export class SaveAsSink implements ExportSink {
  readonly id = 'save-as'
  readonly label = '另存为…'
  readonly description = '开始前选择保存位置,边录边写盘'
  private writable: FileSystemWritableFileStream | undefined

  available(): boolean {
    return typeof (window as any).showSaveFilePicker === 'function'
  }

  async start(meta: ExportSinkMeta): Promise<void> {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: meta.suggestedName,
    })
    this.writable =
      (await handle.createWritable()) as FileSystemWritableFileStream
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writable!.write(chunk)
  }

  async finish(): Promise<void> {
    await this.writable!.close()
    this.writable = undefined
  }

  async abort(): Promise<void> {
    // abort 后文件里可能留有已写入的前缀,浏览器不保证删得掉,尽力而为
    await this.writable?.abort()
    this.writable = undefined
  }
}

/** 当前可用的导出目标,按推荐顺序 */
export function listSinks(): ExportSink[] {
  return [new SaveAsSink(), new BlobDownloadSink()].filter((s) => s.available())
}
