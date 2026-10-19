/*
 * @jest-environment jsdom
 */
/**
 * 桥接二进制适配(2026-10-19,Task 6,spec §10.2):
 *
 * - hydrate:`{file:{fileId,...}}` → GET `${httpUrl}/v1/files/<fileId>`
 *   (Bearer token)→ File;401 → UNAUTHORIZED,404 → FILE_NOT_FOUND,
 *   其余非 ok / fetch 拒绝(CORS/网络)→ NETWORK_ERROR;CORS 日志保留
 *   httpUrl 与 location.origin,提示宿主加精确 origin(不建议 *),
 *   token 绝不进日志;
 * - dehydrate:succeeded 任务结果里的 Blob(VideoExportResult)→ POST
 *   `${httpUrl}/v1/files`(X-File-Name encodeURIComponent、Content-Type、
 *   Bearer)→ result 换成 {fileId,fileName,mimeType,size},不带 Blob;
 *   上传失败 → 任务投影为 failed NETWORK_ERROR,绝不报告成功但缺文件。
 */
import {AgentApiError} from './errors'
import type {JobSnapshot} from './types'
import {hydrateCommandArgs, dehydrateJobResult} from './bridgeFiles'

const transport = {
  httpUrl: 'http://127.0.0.1:43110',
  token: 'secret-token',
}

/** fetch 替身形状(只需本套件用到的字段) */
function fakeResponse(init: {
  ok: boolean
  status: number
  arrayBuffer?: () => Promise<ArrayBuffer>
  json?: () => Promise<unknown>
}) {
  return {
    ok: init.ok,
    status: init.status,
    arrayBuffer: init.arrayBuffer ?? (async () => new ArrayBuffer(0)),
    json: init.json ?? (async () => ({})),
    headers: {get: () => null},
  }
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('hydrateCommandArgs', () => {
  test('fileRef → 下载字节并构造 File(名称/类型/字节正确),带 Bearer token', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchMock = jest.fn(async () =>
      fakeResponse({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      }),
    )

    const hydrated = (await hydrateCommandArgs(
      {
        file: {
          fileId: 'f1',
          fileName: 'Y Bot.glb',
          mimeType: 'model/gltf-binary',
        },
      },
      transport,
      fetchMock as unknown as typeof fetch,
    )) as {file: File}

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      {headers: Record<string, string>},
    ]
    expect(url).toBe('http://127.0.0.1:43110/v1/files/f1')
    expect(init.headers.Authorization).toBe('Bearer secret-token')

    expect(hydrated.file).toBeInstanceOf(File)
    expect(hydrated.file.name).toBe('Y Bot.glb')
    expect(hydrated.file.type).toBe('model/gltf-binary')
    expect(hydrated.file.size).toBe(4)
    // jsdom 的 File 无 arrayBuffer():用 FileReader 读回字节
    const readBack = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () =>
        resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(hydrated.file)
    })
    expect(readBack).toEqual(bytes)
  })

  test('无 fileRef 的 args 原样返回(同引用),不发起 fetch', async () => {
    const fetchMock = jest.fn()
    const args = {objectId: 'model:M', props: {position: {x: 1, y: 0, z: 0}}}
    const result = await hydrateCommandArgs(
      args,
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(result).toBe(args)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('file 已是 File(JS 侧直呼)时不重新下载', async () => {
    const fetchMock = jest.fn()
    const file = new File([new Uint8Array([9])], 'm.glb', {
      type: 'model/gltf-binary',
    })
    const args = {file}
    const result = await hydrateCommandArgs(
      args,
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(result).toBe(args)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('401 → UNAUTHORIZED', async () => {
    const fetchMock = jest.fn(async () =>
      fakeResponse({ok: false, status: 401}),
    )
    const error = await hydrateCommandArgs(
      {file: {fileId: 'f1'}},
      transport,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentApiError)
    expect((error as AgentApiError).code).toBe('UNAUTHORIZED')
  })

  test('404 → FILE_NOT_FOUND', async () => {
    const fetchMock = jest.fn(async () =>
      fakeResponse({ok: false, status: 404}),
    )
    const error = await hydrateCommandArgs(
      {file: {fileId: 'missing'}},
      transport,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentApiError)
    expect((error as AgentApiError).code).toBe('FILE_NOT_FOUND')
  })

  test('其余非 ok(如 500)→ NETWORK_ERROR', async () => {
    const fetchMock = jest.fn(async () =>
      fakeResponse({ok: false, status: 500}),
    )
    const error = await hydrateCommandArgs(
      {file: {fileId: 'f1'}},
      transport,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentApiError)
    expect((error as AgentApiError).code).toBe('NETWORK_ERROR')
  })

  test('fetch 拒绝(CORS/网络)→ NETWORK_ERROR;日志保留 httpUrl 与 origin,不含 token', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await hydrateCommandArgs(
      {file: {fileId: 'f1'}},
      transport,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentApiError)
    expect((error as AgentApiError).code).toBe('NETWORK_ERROR')
    expect((error as AgentApiError).retryable).toBe(true)

    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('http://127.0.0.1:43110')
    expect(logged).toContain(location.origin)
    expect(logged).toContain('corsOrigins')
    expect(logged).not.toContain('secret-token')
  })
})

describe('dehydrateJobResult', () => {
  function videoSnapshot(): JobSnapshot<unknown> {
    return {
      jobId: 'j1',
      kind: 'exports.startVideo',
      state: 'succeeded',
      progress: 1,
      phase: 'loaded',
      cancelable: true,
      result: {
        blob: new Blob(['webm-bytes'], {type: 'video/webm'}),
        fileName: '镜头 1.webm',
        mimeType: 'video/webm',
        size: 10,
      },
    }
  }

  test('Blob 结果 POST 到 /v1/files,result 换成 fileId 描述(不含 Blob)', async () => {
    const snapshot = videoSnapshot()
    const blob = (snapshot.result as {blob: Blob}).blob
    const fetchMock = jest.fn(async () =>
      fakeResponse({
        ok: true,
        status: 201,
        json: async () => ({
          ok: true,
          result: {
            fileId: 'f9',
            fileName: '镜头 1.webm',
            mimeType: 'video/webm',
            size: 10,
          },
        }),
      }),
    )

    const projected = await dehydrateJobResult(
      snapshot,
      transport,
      fetchMock as unknown as typeof fetch,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      {method: string; headers: Record<string, string>; body: unknown},
    ]
    expect(url).toBe('http://127.0.0.1:43110/v1/files')
    expect(init.method).toBe('POST')
    expect(init.headers['X-File-Name']).toBe(encodeURIComponent('镜头 1.webm'))
    expect(init.headers['Content-Type']).toBe('video/webm')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.body).toBe(blob)

    expect(projected.state).toBe('succeeded')
    expect(projected.result).toEqual({
      fileId: 'f9',
      fileName: '镜头 1.webm',
      mimeType: 'video/webm',
      size: 10,
    })
    expect((projected.result as Record<string, unknown>).blob).toBeUndefined()
    // 原始快照不被改写
    expect((snapshot.result as {blob: Blob}).blob).toBe(blob)
  })

  test('上传失败 → 任务投影为 failed NETWORK_ERROR(绝不报告成功但缺文件)', async () => {
    const fetchMock = jest.fn(async () =>
      fakeResponse({ok: false, status: 500}),
    )
    const projected = await dehydrateJobResult(
      videoSnapshot(),
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(projected.state).toBe('failed')
    expect(projected.error?.code).toBe('NETWORK_ERROR')
    expect(projected.result).toBeUndefined()
  })

  test('上传 fetch 拒绝(CORS/网络)→ failed NETWORK_ERROR;日志不含 token', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const projected = await dehydrateJobResult(
      videoSnapshot(),
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(projected.state).toBe('failed')
    expect(projected.error?.code).toBe('NETWORK_ERROR')
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('http://127.0.0.1:43110')
    expect(logged).not.toContain('secret-token')
  })

  test('非 Blob 结果原样返回(同引用),不发起 fetch', async () => {
    const fetchMock = jest.fn()
    const snapshot: JobSnapshot<unknown> = {
      jobId: 'j2',
      kind: 'assets.importModel',
      state: 'succeeded',
      progress: 1,
      phase: 'loaded',
      cancelable: false,
      result: {assetId: 'asset-1'},
    }
    const projected = await dehydrateJobResult(
      snapshot,
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(projected).toBe(snapshot)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('非 succeeded 状态不上传(同引用返回)', async () => {
    const fetchMock = jest.fn()
    const snapshot: JobSnapshot<unknown> = {
      jobId: 'j3',
      kind: 'exports.startVideo',
      state: 'running',
      progress: 0.3,
      phase: 'committed',
      cancelable: true,
    }
    const projected = await dehydrateJobResult(
      snapshot,
      transport,
      fetchMock as unknown as typeof fetch,
    )
    expect(projected).toBe(snapshot)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
