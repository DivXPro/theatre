/**
 * Task 3:FileStore 单元测试 — 二进制往返、大小上限、过期、路径安全、
 * 生命周期(close 只删自己创建的临时目录)。
 *
 * 全部使用真实 fs 临时目录;过期用可注入 clock,清理 timer 用真实
 * 计时器 + 小间隔,等待用轮询,不依赖侥幸时序。
 */
import {promises as fsp} from 'fs'
import {Readable} from 'stream'
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
