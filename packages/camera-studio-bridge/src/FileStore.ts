/**
 * Task 3:有界二进制临时文件存储(spec 第 10.2 节)。
 *
 * 安全与资源约束:
 * - fileId 由本进程 `randomUUID()` 生成,磁盘路径只允许
 *   `<dir>/<fileId>.bin`;外部输入(含 `../`、编码斜线)只作为 Map 键
 *   查询单个 fileId,绝不参与路径拼接,因此不可能逃出临时目录;
 * - `put` 用 `wx` 标志创建文件,流式写入并累计字节;超过
 *   maxUploadBytes 或源流错误时关闭写入并 unlink 部分文件,元数据
 *   不登记,临时目录不残留;
 * - 超限前先排空剩余请求体再抛 413(与 /v1/commands 的 413 语义一致:
 *   排空保证响应确定性送达,`Connection: close` 只关该请求的连接);
 * - 过期判定使用可注入 clock;过期 get/openReadStream 返回
 *   FILE_NOT_FOUND 并删除磁盘文件;后台 sweep timer 定期清理;
 * - `close()` 停止 sweep timer,只删除本实例 `mkdtemp` 创建的目录;
 * - 本模块不打印任何内容,文件内容与凭据绝不出现在日志中。
 */

import {randomUUID} from 'crypto'
import {once} from 'events'
import {createReadStream, createWriteStream, mkdtempSync} from 'fs'
import {promises as fsp} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import type {Readable, Writable} from 'stream'
import {BridgeHttpError} from './errors'

/** 上传/下载结果元数据(POST /v1/files 的 result,任务输出引用同形) */
export type FileDescriptor = {
  fileId: string
  fileName: string
  mimeType: string
  size: number
}

/** 可注入时钟,过期测试用;默认 `Date.now` */
export type FileStoreClock = {
  now(): number
}

export type CreateFileStoreOptions = {
  maxUploadBytes: number
  fileTtlMs: number
  clock?: FileStoreClock
  /** 后台清理间隔;默认 min(fileTtlMs, 60s),测试可注入小间隔 */
  sweepIntervalMs?: number
  /**
   * 故障注入/测试用写流工厂;默认 `fs.createWriteStream(path, {flags:'wx'})`。
   * 生产代码不应设置。
   */
  writeStreamFactory?: (filePath: string) => Writable
}

export type FileStore = {
  /** 本实例独占的临时目录(仅用于测试断言与运维排查) */
  readonly dir: string
  put(input: {
    stream: Readable
    fileName: string
    mimeType: string
  }): Promise<FileDescriptor>
  /** 不存在或过期抛 `BridgeHttpError`(404 FILE_NOT_FOUND) */
  get(fileId: string): FileDescriptor
  /** 与 get 同样的存在/过期检查,通过后返回磁盘读流 */
  openReadStream(fileId: string): Readable
  /** 幂等删除;未知 id 静默成功 */
  delete(fileId: string): Promise<void>
  /** 停止 sweep timer,删除本实例创建的临时目录 */
  close(): Promise<void>
}

type FileEntry = FileDescriptor & {
  filePath: string
  createdAt: number
}

function fileNotFound(): BridgeHttpError {
  return new BridgeHttpError(404, 'FILE_NOT_FOUND', '文件不存在或已过期')
}

export function createFileStore(options: CreateFileStoreOptions): FileStore {
  const clock: FileStoreClock = options.clock ?? {now: () => Date.now()}
  const dir = mkdtempSync(join(tmpdir(), 'camera-studio-bridge-'))
  // 元数据只存内存:桥接重启后旧 fileId 一律 FILE_NOT_FOUND,
  // 不承诺跨重启的临时文件保留
  const entries = new Map<string, FileEntry>()
  let closed = false

  const expired = (entry: FileEntry): boolean =>
    clock.now() - entry.createdAt >= options.fileTtlMs

  async function removeEntry(entry: FileEntry): Promise<void> {
    entries.delete(entry.fileId)
    await fsp.unlink(entry.filePath).catch(() => {})
  }

  function lookup(fileId: string): FileEntry {
    const entry = entries.get(fileId)
    if (entry === undefined) throw fileNotFound()
    if (expired(entry)) {
      // 过期即删:磁盘清理异步完成,判定结果不依赖清理时机
      void removeEntry(entry)
      throw fileNotFound()
    }
    return entry
  }

  const sweep = setInterval(
    () => {
      for (const entry of [...entries.values()]) {
        if (expired(entry)) void removeEntry(entry)
      }
    },
    options.sweepIntervalMs ?? Math.min(options.fileTtlMs, 60_000),
  )
  // 清理 timer 不得阻止进程退出
  sweep.unref()

  async function put(input: {
    stream: Readable
    fileName: string
    mimeType: string
  }): Promise<FileDescriptor> {
    if (closed) {
      throw new BridgeHttpError(500, 'STORAGE_ERROR', '文件存储已关闭')
    }
    const fileId = randomUUID()
    // 磁盘路径只允许 <fileId>.bin;fileId 是本进程生成的 UUID,
    // 外部输入永远走 Map 键查询,到不了这里
    const filePath = join(dir, `${fileId}.bin`)
    // wx:已存在即失败,防止任何覆盖既有文件的路径
    const out = options.writeStreamFactory
      ? options.writeStreamFactory(filePath)
      : createWriteStream(filePath, {flags: 'wx'})
    /**
     * 持久错误监听:从创建起就挂上,任何时机(无背压的 flush 阶段、
     * drain 竞速落定之后)的写错误都只记录到 writeError,绝不成为
     * uncaught exception;循环与收尾统一读取该变量决定拒绝。
     */
    let writeError: Error | undefined
    out.on('error', (error: Error) => {
      writeError = error
    })
    /**
     * 等 drain 或写错误落定。两个事件都只是"醒来重查 writeError",
     * handler 绝不抛异常,胜出方清理双方监听器——不留竞速落败方的
     * 残留监听,因此不会产生 unhandled rejection。
     */
    function waitDrainOrError(): Promise<void> {
      return new Promise<void>((resolve) => {
        if (writeError !== undefined || out.destroyed || out.closed) {
          resolve()
          return
        }
        const wake = () => {
          out.removeListener('drain', wake)
          out.removeListener('error', wake)
          resolve()
        }
        out.once('drain', wake)
        out.once('error', wake)
      })
    }
    /** 写完并等待 finish/writeError;error 优先,绝不静默吞掉写入失败 */
    function finishWrite(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (writeError !== undefined) {
          reject(writeError)
          return
        }
        const onError = () => {
          out.removeListener('finish', onFinish)
          reject(writeError ?? new Error('写入失败'))
        }
        const onFinish = () => {
          out.removeListener('error', onError)
          if (writeError !== undefined) reject(writeError)
          else resolve()
        }
        out.once('error', onError)
        out.once('finish', onFinish)
        out.end()
      })
    }
    let size = 0
    let tooLarge = false
    try {
      for await (const chunk of input.stream as AsyncIterable<Buffer>) {
        if (writeError !== undefined) throw writeError
        if (tooLarge) continue // 排空剩余 body,保证 413 确定性送达
        size += chunk.length
        if (size > options.maxUploadBytes) {
          tooLarge = true
          continue
        }
        if (!out.write(chunk)) {
          // 背压:等 drain 或写错误落定,醒来统一由循环顶的 writeError
          // 检查决定中止
          await waitDrainOrError()
        }
      }
      if (writeError !== undefined) throw writeError
      if (tooLarge) {
        throw new BridgeHttpError(
          413,
          'PAYLOAD_TOO_LARGE',
          `上传超过 maxUploadBytes(${options.maxUploadBytes} 字节)`,
          {closeConnection: true},
        )
      }
      await finishWrite()
    } catch (error) {
      // 超限或源流/写流错误:关闭并 unlink 部分文件,绝不留下半成品。
      // 若首个块就已超限,写流可能从未收到字节、open 仍在 pending:
      // 必须先等 close 落定再 unlink,否则 open 完成后会重建文件
      out.destroy()
      if (!out.closed) await once(out, 'close').catch(() => {})
      await fsp.unlink(filePath).catch(() => {})
      throw error
    }
    const entry: FileEntry = {
      fileId,
      fileName: input.fileName === '' ? fileId : input.fileName,
      mimeType: input.mimeType,
      size,
      filePath,
      createdAt: clock.now(),
    }
    entries.set(fileId, entry)
    return {
      fileId: entry.fileId,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      size: entry.size,
    }
  }

  function get(fileId: string): FileDescriptor {
    const entry = lookup(fileId)
    return {
      fileId: entry.fileId,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      size: entry.size,
    }
  }

  function openReadStream(fileId: string): Readable {
    const entry = lookup(fileId)
    return createReadStream(entry.filePath)
  }

  async function deleteFile(fileId: string): Promise<void> {
    const entry = entries.get(fileId)
    if (entry === undefined) return
    await removeEntry(entry)
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    clearInterval(sweep)
    entries.clear()
    // 只删除本实例 mkdtemp 创建的目录
    await fsp.rm(dir, {recursive: true, force: true})
  }

  return {dir, put, get, openReadStream, delete: deleteFile, close}
}
