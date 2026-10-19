/**
 * Task 3:FileStore 单元测试 — 二进制往返、大小上限、过期、路径安全、
 * 生命周期(close 只删自己创建的临时目录)。
 *
 * 全部使用真实 fs 临时目录;过期用可注入 clock,清理 timer 用真实
 * 计时器 + 小间隔,等待用轮询,不依赖侥幸时序。
 */
import {appendFileSync, promises as fsp} from 'fs'
import {Readable, Writable} from 'stream'
import {BridgeHttpError} from './errors'
import {createFileStore} from './FileStore'
import type {FileStore, FileStoreClock} from './FileStore'

const BINARY_BYTES = Buffer.from([0, 255, 1, 128, 10, 13])

const stores: FileStore[] = []

function makeStore(options: {
  maxUploadBytes?: number
  fileTtlMs?: number
  clock?: FileStoreClock
  sweepIntervalMs?: number
}): FileStore {
  const store = createFileStore({
    maxUploadBytes: options.maxUploadBytes ?? 1024,
    fileTtlMs: options.fileTtlMs ?? 60_000,
    ...(options.clock !== undefined ? {clock: options.clock} : {}),
    ...(options.sweepIntervalMs !== undefined
      ? {sweepIntervalMs: options.sweepIntervalMs}
      : {}),
  })
  stores.push(store)
  return store
}

afterEach(async () => {
  while (stores.length > 0) {
    const store = stores.pop()!
    await store.close()
  }
})

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function dirEntries(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

describe('put/get roundtrip', () => {
  test('stores streamed bytes and returns the descriptor', async () => {
    const store = makeStore({})
    const descriptor = await store.put({
      stream: Readable.from([
        BINARY_BYTES.subarray(0, 2),
        BINARY_BYTES.subarray(2),
      ]),
      fileName: '模型.glb',
      mimeType: 'model/gltf-binary',
    })
    expect(descriptor.fileName).toBe('模型.glb')
    expect(descriptor.mimeType).toBe('model/gltf-binary')
    expect(descriptor.size).toBe(BINARY_BYTES.length)
    expect(descriptor.fileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    const diskPath = `${store.dir}/${descriptor.fileId}.bin`
    expect(await fsp.readFile(diskPath)).toEqual(BINARY_BYTES)
    expect(await dirEntries(store.dir)).toEqual([`${descriptor.fileId}.bin`])

    expect(store.get(descriptor.fileId)).toEqual(descriptor)
    await expect(
      readAll(store.openReadStream(descriptor.fileId)),
    ).resolves.toEqual(BINARY_BYTES)
  })

  test('accepts a body of exactly maxUploadBytes', async () => {
    const store = makeStore({maxUploadBytes: BINARY_BYTES.length})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'exact.bin',
      mimeType: 'application/octet-stream',
    })
    expect(descriptor.size).toBe(BINARY_BYTES.length)
    await expect(
      readAll(store.openReadStream(descriptor.fileId)),
    ).resolves.toEqual(BINARY_BYTES)
  })

  test('falls back to the fileId as fileName when none is given', async () => {
    const store = makeStore({})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: '',
      mimeType: 'application/octet-stream',
    })
    expect(descriptor.fileName).toBe(descriptor.fileId)
  })
})

describe('size limit', () => {
  test('rejects over-limit uploads, returns no fileId and leaves the dir empty', async () => {
    const store = makeStore({maxUploadBytes: 4})
    await expect(
      store.put({
        stream: Readable.from([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])]),
        fileName: 'too-big.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({
      name: 'BridgeHttpError',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      closeConnection: true,
    })
    // 部分文件必须被 unlink,临时目录最终为空
    expect(await dirEntries(store.dir)).toEqual([])
  })

  test('a single oversized chunk is also rejected and cleaned up', async () => {
    const store = makeStore({maxUploadBytes: 4})
    await expect(
      store.put({
        stream: Readable.from(Buffer.alloc(1024, 7)),
        fileName: 'one-chunk.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({code: 'PAYLOAD_TOO_LARGE'})
    expect(await dirEntries(store.dir)).toEqual([])
  })

  test('a failing source stream removes the partial file', async () => {
    const store = makeStore({})
    const failing = new Readable({
      read() {
        this.push(Buffer.from([1, 2, 3]))
        this.destroy(new Error('stream boom'))
      },
    })
    await expect(
      store.put({
        stream: failing,
        fileName: 'broken.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toThrow('stream boom')
    await waitFor(async () => (await dirEntries(store.dir)).length === 0)
  })
})

describe('get and path safety', () => {
  test('unknown ids throw FILE_NOT_FOUND', async () => {
    const store = makeStore({})
    for (const id of [
      'no-such-file',
      '../escape',
      '..%2F..%2Fetc%2Fpasswd',
      'a/b',
      '',
      '.',
      '..',
    ]) {
      let caught: unknown
      try {
        store.get(id)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(BridgeHttpError)
      expect((caught as BridgeHttpError).status).toBe(404)
      expect((caught as BridgeHttpError).code).toBe('FILE_NOT_FOUND')
    }
  })

  test('openReadStream on an unknown id throws FILE_NOT_FOUND before touching disk', () => {
    const store = makeStore({})
    expect(() => store.openReadStream('../../etc/passwd')).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
  })

  test('delete is idempotent for unknown ids', async () => {
    const store = makeStore({})
    await expect(store.delete('no-such-file')).resolves.toBeUndefined()
  })

  test('delete removes the disk file and the descriptor', async () => {
    const store = makeStore({})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'bye.bin',
      mimeType: 'application/octet-stream',
    })
    await store.delete(descriptor.fileId)
    expect(() => store.get(descriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
    expect(await dirEntries(store.dir)).toEqual([])
  })
})

function fakeClock(start = 1_000_000) {
  let now = start
  const clock: FileStoreClock = {now: () => now}
  return {
    clock,
    advance(ms: number) {
      now += ms
    },
  }
}

describe('expiry', () => {
  test('get on an expired file throws FILE_NOT_FOUND and deletes the disk file', async () => {
    const {clock, advance} = fakeClock()
    const store = makeStore({fileTtlMs: 1000, clock})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'short-lived.bin',
      mimeType: 'application/octet-stream',
    })
    expect(store.get(descriptor.fileId)).toEqual(descriptor)

    advance(1001)
    expect(() => store.get(descriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND', status: 404}),
    )
    await waitFor(async () => (await dirEntries(store.dir)).length === 0)
  })

  test('openReadStream on an expired file throws FILE_NOT_FOUND', async () => {
    const {clock, advance} = fakeClock()
    const store = makeStore({fileTtlMs: 1000, clock})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'short-lived.bin',
      mimeType: 'application/octet-stream',
    })
    advance(1001)
    expect(() => store.openReadStream(descriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
  })

  test('a file at the exact ttl boundary still serves; past it does not', async () => {
    const {clock, advance} = fakeClock()
    const store = makeStore({fileTtlMs: 1000, clock})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'boundary.bin',
      mimeType: 'application/octet-stream',
    })
    advance(999)
    expect(store.get(descriptor.fileId).fileId).toBe(descriptor.fileId)
    advance(1)
    expect(() => store.get(descriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
  })

  test('the sweep timer removes expired files without any access', async () => {
    const {clock, advance} = fakeClock()
    const store = makeStore({fileTtlMs: 1000, clock, sweepIntervalMs: 10})
    await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'swept.bin',
      mimeType: 'application/octet-stream',
    })
    advance(1001)
    await waitFor(async () => (await dirEntries(store.dir)).length === 0)
  })
})

describe('close', () => {
  test('close removes only its own temp dir and stops the sweep timer', async () => {
    const {clock, advance} = fakeClock()
    const first = makeStore({fileTtlMs: 1000, clock, sweepIntervalMs: 10})
    const second = makeStore({fileTtlMs: 1000, clock, sweepIntervalMs: 10})
    expect(first.dir).not.toBe(second.dir)

    const firstDir = first.dir
    const secondDescriptor = await second.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'keep.bin',
      mimeType: 'application/octet-stream',
    })
    await first.close()
    await expect(fsp.stat(firstDir)).rejects.toMatchObject({code: 'ENOENT'})
    // 第二个 store 的目录与内容不受影响
    expect(await dirEntries(second.dir)).toEqual([
      `${secondDescriptor.fileId}.bin`,
    ])

    // close 后 timer 已停:过期文件不再被后台清理(目录都没了也无从清理),
    // 只验证第二个 store 仍正常工作
    advance(1001)
    expect(() => second.get(secondDescriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
  })

  test('put after close rejects and get after close throws FILE_NOT_FOUND', async () => {
    const store = makeStore({})
    const descriptor = await store.put({
      stream: Readable.from(BINARY_BYTES),
      fileName: 'gone.bin',
      mimeType: 'application/octet-stream',
    })
    await store.close()
    expect(() => store.get(descriptor.fileId)).toThrow(
      expect.objectContaining({code: 'FILE_NOT_FOUND'}),
    )
    await expect(
      store.put({
        stream: Readable.from(BINARY_BYTES),
        fileName: 'late.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toThrow()
  })
})

describe('write stream errors (fault injection)', () => {
  /**
   * 断言动作期间没有任何进程级错误事件(uncaughtException /
   * unhandledRejection)。挂上自己的监听器既防止进程崩溃,又能
   * 捕获计数;事件落定需要给异步错误留出时间窗。
   */
  async function expectNoProcessErrors(action: () => Promise<void>) {
    const processEvents: string[] = []
    const onUncaught = (error: unknown) =>
      processEvents.push(`uncaughtException: ${String(error)}`)
    const onUnhandled = (error: unknown) =>
      processEvents.push(`unhandledRejection: ${String(error)}`)
    process.on('uncaughtException', onUncaught)
    process.on('unhandledRejection', onUnhandled)
    try {
      await action()
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      process.removeListener('uncaughtException', onUncaught)
      process.removeListener('unhandledRejection', onUnhandled)
    }
    expect(processEvents).toEqual([])
  }

  /**
   * 写入超过 failAfter 字节后异步报错的 Writable;报错前把部分字节
   * 真实落盘,以便验证 put 的 catch 确实 unlink 了部分文件。
   * 默认 highWaterMark(16KB)下小 chunk 的 write() 返回 true,
   * 即"无背压"路径——旧实现此时写流没有 error 监听,会进程崩溃。
   */
  class FailAfterBytesStream extends Writable {
    private written = 0
    constructor(
      private readonly filePath: string,
      private readonly failAfter: number,
    ) {
      super()
    }
    _write(
      chunk: Buffer,
      _encoding: string,
      callback: (error?: Error | null) => void,
    ): void {
      const next = this.written + chunk.length
      if (next > this.failAfter) {
        // 模拟 flush 阶段磁盘错误(如 ENOSPC):先落一部分字节再异步报错
        appendFileSync(this.filePath, chunk.subarray(0, 1))
        this.written = next
        setImmediate(() => callback(new Error('simulated ENOSPC')))
        return
      }
      this.written = next
      appendFileSync(this.filePath, chunk)
      setImmediate(callback)
    }
  }

  /**
   * highWaterMark=1 使每次 write() 都返回 false(背压),_write 延迟
   * 完成产生多个 drain 周期;第 failOn 次写入报错——旧实现在 drain
   * 赢得竞速后残留 once('error') 监听,错误到达时产生 unhandled
   * rejection。
   */
  class BackpressuredFailStream extends Writable {
    private count = 0
    constructor(
      private readonly filePath: string,
      private readonly failOn: number,
    ) {
      super({highWaterMark: 1})
    }
    _write(
      chunk: Buffer,
      _encoding: string,
      callback: (error?: Error | null) => void,
    ): void {
      this.count++
      const n = this.count
      setImmediate(() => {
        if (n === this.failOn) {
          callback(new Error('late write boom'))
          return
        }
        appendFileSync(this.filePath, chunk)
        callback()
      })
    }
  }

  /** 每块之间让出一个事件循环 tick,让异步错误有时间在循环中途落定 */
  async function* pacedChunks(count: number, bytes: number) {
    for (let i = 0; i < count; i++) {
      yield Buffer.alloc(bytes, i + 1)
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  test('a write error while NOT backpressured rejects put without crashing the process', async () => {
    let factorySawPath = ''
    const store = createFileStore({
      maxUploadBytes: 1024,
      fileTtlMs: 60_000,
      writeStreamFactory: (filePath) => {
        factorySawPath = filePath
        return new FailAfterBytesStream(filePath, 8)
      },
    })
    stores.push(store)
    await expectNoProcessErrors(async () => {
      await expect(
        store.put({
          stream: Readable.from(pacedChunks(4, 8)),
          fileName: 'enospc.bin',
          mimeType: 'application/octet-stream',
        }),
      ).rejects.toThrow('simulated ENOSPC')
    })
    // 部分文件(第一块 8 字节 + 第二块 1 字节)必须被 unlink
    expect(factorySawPath).not.toBe('')
    expect(await dirEntries(store.dir)).toEqual([])
  })

  test('a write error after several drain cycles rejects cleanly with no unhandled rejection', async () => {
    let injected: BackpressuredFailStream | undefined
    const store = createFileStore({
      maxUploadBytes: 1024,
      fileTtlMs: 60_000,
      writeStreamFactory: (filePath) => {
        injected = new BackpressuredFailStream(filePath, 4)
        return injected
      },
    })
    stores.push(store)
    await expectNoProcessErrors(async () => {
      await expect(
        store.put({
          stream: Readable.from(pacedChunks(5, 8)),
          fileName: 'drain-then-fail.bin',
          mimeType: 'application/octet-stream',
        }),
      ).rejects.toThrow('late write boom')
    })
    expect(await dirEntries(store.dir)).toEqual([])
    // 竞速落败方的监听器必须被清理:drain 监听器归零,error 上只剩
    // put 的持久记录器一个。旧实现在每个 drain 周期泄漏一个 error
    // 监听(实测 3 次背压后 listenerCount 涨到 6)。
    expect(injected?.listenerCount('drain')).toBe(0)
    expect(injected?.listenerCount('error')).toBe(1)
  })
})
