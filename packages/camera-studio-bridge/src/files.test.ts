/**
 * Task 3:HTTP 文件传输路由 — POST /v1/files 上传、GET /v1/files/:id 下载、
 * 超限 413、过期/未知 404、路径攻击不逃出临时目录、鉴权包裹。
 *
 * 真实 http.Server 绑 127.0.0.1:0,FileStore 用真实实现(临时目录);
 * 请求/响应体按 Buffer 比对,绝不经过文本编码。
 */
import http from 'http'
import {promises as fsp} from 'fs'
import type {AddressInfo} from 'net'
import {resolveBridgeConfig, type ResolvedBridgeConfig} from './config'
import {createHttpServer} from './httpServer'
import {createFileStore} from './FileStore'
import type {FileStore} from './FileStore'
import type {CommandResponse} from './types'

/** 测试专用 token,不是任何真实凭据 */
const TOKEN = 'test-bridge-token'

const BINARY_BYTES = Buffer.from([0, 255, 1, 128, 10, 13])

function createFakeSession() {
  return {
    health: () => ({scene: 'unavailable' as const}),
    schema: () => undefined,
    async execute(): Promise<CommandResponse> {
      throw new Error('files tests must not reach the session')
    },
  }
}

const servers: http.Server[] = []
const stores: FileStore[] = []

type Started = {
  baseUrl: string
  store: FileStore
}

async function startServer(options: {
  config?: ResolvedBridgeConfig
  store?: FileStore
  maxUploadBytes?: number
  fileTtlMs?: number
}): Promise<Started> {
  const config = options.config ?? resolveBridgeConfig({token: TOKEN})
  const store =
    options.store ??
    createFileStore({
      maxUploadBytes: options.maxUploadBytes ?? config.maxUploadBytes,
      fileTtlMs: options.fileTtlMs ?? config.fileTtlMs,
    })
  stores.push(store)
  const server = createHttpServer({
    config,
    session: createFakeSession(),
    files: store,
  })
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const {port} = server.address() as AddressInfo
  return {baseUrl: `http://127.0.0.1:${port}`, store}
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  while (stores.length > 0) {
    const store = stores.pop()!
    await store.close()
  }
})

type HttpResult = {
  status: number
  headers: http.IncomingHttpHeaders
  /** 原始字节;下载比对必须用它,不能经 utf8 文本 */
  bodyBytes: Buffer
  json: () => any
}

function request(
  baseUrl: string,
  options: {
    method?: string
    path: string
    headers?: Record<string, string>
    body?: Buffer
  },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, baseUrl)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const bodyBytes = Buffer.concat(chunks)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bodyBytes,
            json: () => JSON.parse(bodyBytes.toString('utf8')),
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

function authedHeaders(extra: Record<string, string> = {}) {
  return {Authorization: `Bearer ${TOKEN}`, ...extra}
}

async function dirEntries(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}

describe('POST /v1/files then GET /v1/files/:id', () => {
  test('round-trips binary bytes exactly with name and mime metadata', async () => {
    const {baseUrl} = await startServer({})
    const upload = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      headers: authedHeaders({
        'Content-Type': 'model/gltf-binary',
        'X-File-Name': encodeURIComponent('模型.glb'),
      }),
      body: BINARY_BYTES,
    })
    expect(upload.status).toBe(201)
    const descriptor = upload.json().result
    expect(upload.json().ok).toBe(true)
    expect(descriptor.fileName).toBe('模型.glb')
    expect(descriptor.mimeType).toBe('model/gltf-binary')
    expect(descriptor.size).toBe(BINARY_BYTES.length)
    expect(typeof descriptor.fileId).toBe('string')

    const download = await request(baseUrl, {
      path: `/v1/files/${descriptor.fileId}`,
      headers: authedHeaders(),
    })
    expect(download.status).toBe(200)
    expect(download.bodyBytes).toEqual(BINARY_BYTES)
    expect(download.headers['content-type']).toBe('model/gltf-binary')
    expect(download.headers['content-length']).toBe(String(BINARY_BYTES.length))
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('模型.glb')}`,
    )
  })

  test('defaults the mime type to application/octet-stream', async () => {
    const {baseUrl} = await startServer({})
    const upload = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      headers: authedHeaders(),
      body: BINARY_BYTES,
    })
    expect(upload.status).toBe(201)
    expect(upload.json().result.mimeType).toBe('application/octet-stream')
    const descriptor = upload.json().result
    const download = await request(baseUrl, {
      path: `/v1/files/${descriptor.fileId}`,
      headers: authedHeaders(),
    })
    expect(download.headers['content-type']).toBe('application/octet-stream')
  })

  test('rejects malformed X-File-Name encodings with 400', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      headers: authedHeaders({'X-File-Name': '%E4%B8%AD%ZZ'}),
      body: BINARY_BYTES,
    })
    // %ZZ 不是合法百分号编码,decodeURIComponent 抛错 → 400
    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('INVALID_ARGUMENT')
  })

  test('requires authentication on both upload and download', async () => {
    const {baseUrl} = await startServer({})
    const upload = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      body: BINARY_BYTES,
    })
    expect(upload.status).toBe(401)
    const download = await request(baseUrl, {path: '/v1/files/whatever'})
    expect(download.status).toBe(401)
  })

  test('unknown file ids return 404 FILE_NOT_FOUND', async () => {
    const {baseUrl} = await startServer({})
    const res = await request(baseUrl, {
      path: '/v1/files/01234567-89ab-cdef-0123-456789abcdef',
      headers: authedHeaders(),
    })
    expect(res.status).toBe(404)
    expect(res.json()).toEqual({
      ok: false,
      error: {
        code: 'FILE_NOT_FOUND',
        message: expect.any(String),
        retryable: false,
      },
    })
  })

  test('path traversal segments are treated as a single fileId and never escape the temp dir', async () => {
    const {baseUrl, store} = await startServer({})
    // 编码斜线:URL 不解码 %2F,整段只按一个 fileId 处理
    const encoded = await request(baseUrl, {
      path: '/v1/files/..%2F..%2Fetc%2Fpasswd',
      headers: authedHeaders(),
    })
    expect(encoded.status).toBe(404)
    expect(encoded.json().error.code).toBe('FILE_NOT_FOUND')
    expect(encoded.bodyBytes.toString('utf8')).not.toContain('root:')

    // 裸 ../:URL 规范化后不再是 /v1/files/:id 路由,同样 404
    const raw = await request(baseUrl, {
      path: '/v1/files/../../etc/passwd',
      headers: authedHeaders(),
    })
    expect(raw.status).toBe(404)
    expect(raw.bodyBytes.toString('utf8')).not.toContain('root:')

    // 临时目录里只有 store 自己创建的文件(这里为空),攻击未造出任何文件
    expect(await dirEntries(store.dir)).toEqual([])
  })

  test('a closed store makes previously uploaded files unavailable', async () => {
    const {baseUrl, store} = await startServer({})
    const upload = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      headers: authedHeaders(),
      body: BINARY_BYTES,
    })
    const {fileId} = upload.json().result
    await store.close()
    const res = await request(baseUrl, {
      path: `/v1/files/${fileId}`,
      headers: authedHeaders(),
    })
    expect(res.status).toBe(404)
    expect(res.json().error.code).toBe('FILE_NOT_FOUND')
  })
})

describe('upload size limit', () => {
  test('over-limit uploads get a delivered 413, no fileId, and an empty temp dir', async () => {
    const {baseUrl, store} = await startServer({maxUploadBytes: 64})
    const body = Buffer.alloc(256 * 1024, 0x61)
    // 显式 Content-Length + 大 body:服务端必须先排空再应答 413,
    // 重复多次锁定确定性送达(与 /v1/commands 的 413 语义一致)
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(baseUrl, {
        method: 'POST',
        path: '/v1/files',
        headers: authedHeaders({
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
        }),
        body,
      })
      expect(res.status).toBe(413)
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
      // 413 响应不携带任何 fileId
      expect(res.json().result).toBeUndefined()
      expect(res.json().ok).toBe(false)
    }
    // 部分写入的文件必须被清理,临时目录最终为空
    expect(await dirEntries(store.dir)).toEqual([])
  })

  test('a streaming body without Content-Length is counted as it arrives', async () => {
    const {baseUrl, store} = await startServer({maxUploadBytes: 64})
    const res = await new Promise<HttpResult>((resolve, reject) => {
      const url = new URL('/v1/files', baseUrl)
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: authedHeaders({'Content-Type': 'application/octet-stream'}),
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            const bodyBytes = Buffer.concat(chunks)
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              bodyBytes,
              json: () => JSON.parse(bodyBytes.toString('utf8')),
            })
          })
        },
      )
      req.on('error', reject)
      req.write(Buffer.alloc(64, 0x62))
      req.write(Buffer.alloc(64, 0x63))
      req.end()
    })
    expect(res.status).toBe(413)
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(await dirEntries(store.dir)).toEqual([])
  })
})

describe('expiry over HTTP', () => {
  test('an expired file downloads as 404 FILE_NOT_FOUND and is removed from disk', async () => {
    const {baseUrl, store} = await startServer({fileTtlMs: 30})
    const upload = await request(baseUrl, {
      method: 'POST',
      path: '/v1/files',
      headers: authedHeaders(),
      body: BINARY_BYTES,
    })
    const {fileId} = upload.json().result

    const fresh = await request(baseUrl, {
      path: `/v1/files/${fileId}`,
      headers: authedHeaders(),
    })
    expect(fresh.status).toBe(200)

    // 等过期(真实 clock + 短 TTL)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const expired = await request(baseUrl, {
      path: `/v1/files/${fileId}`,
      headers: authedHeaders(),
    })
    expect(expired.status).toBe(404)
    expect(expired.json().error.code).toBe('FILE_NOT_FOUND')
    // 过期 get 必须删除磁盘文件
    const deadline = Date.now() + 3000
    for (;;) {
      if ((await dirEntries(store.dir)).length === 0) break
      if (Date.now() > deadline) {
        throw new Error('expired file was not removed from disk')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
})
