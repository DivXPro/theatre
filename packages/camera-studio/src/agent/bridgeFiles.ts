/**
 * 桥接二进制适配(2026-10-19,Task 6,spec §10.2):File/Blob ↔ fileId。
 *
 * 二进制内容不进 JSON、不经 WebSocket(spec §10.2 硬约束):
 * - hydrate(下载):HTTP 命令 args 里的 `{file:{fileId,...}}` 引用,经
 *   `GET ${httpUrl}/v1/files/<fileId>`(Bearer token)取回字节构造 File
 *   后再进 registry validator——原始 fileRef 不许绕过传输适配直接进入
 *   领域层(assets.importModel validator 只收 File);
 * - dehydrate(上传):succeeded 任务结果里的 Blob(VideoExportResult)
 *   经 `POST ${httpUrl}/v1/files`(X-File-Name encodeURIComponent、
 *   Content-Type、Bearer)写入桥接临时文件,发给桥接的任务快照 result
 *   换成 {fileId,fileName,mimeType,size};上传失败时任务投影为
 *   failed NETWORK_ERROR——绝不报告成功但缺文件。
 *
 * 错误语义:401 → UNAUTHORIZED,404 → FILE_NOT_FOUND,其余非 ok 与
 * fetch 拒绝(CORS/网络)→ NETWORK_ERROR(可重试)。CORS 日志保留
 * httpUrl 与 location.origin,提示宿主把精确 origin 加入桥接
 * corsOrigins(不建议 `*`);token 绝不出现在日志/错误信息中。
 */
import {AgentApiError} from './errors'
import type {JobSnapshot} from './types'

/** 桥接 HTTP 传输凭据(httpUrl + Bearer token;token 绝不进日志) */
export type BridgeFileTransport = {
  httpUrl: string
  token: string
}

/** HTTP 传输形状:POST /v1/files 上传后 Agent 拿到的文件引用 */
export type BridgeFileRef = {
  fileId: string
  fileName?: string
  mimeType?: string
}

/** 桥接返回的临时文件描述(POST /v1/files 201 的 result) */
export type BridgeFileDescriptor = {
  fileId: string
  fileName: string
  mimeType: string
  size: number
}

/** fetch 拒绝(CORS 或网络不可达)时的宿主指引:精确 origin,不建议 * */
function logCorsHint(transport: BridgeFileTransport, action: string): void {
  const origin =
    typeof location !== 'undefined' ? location.origin : '(无 location 信息)'
  // token 绝不出现在日志里:只保留 httpUrl 与页面 origin
  console.error(
    `[camera-studio] 桥接${action}请求失败(可能是 CORS 或网络错误):` +
      `bridge httpUrl=${transport.httpUrl},页面 origin=${origin}。` +
      `请把该精确 origin 加入桥接 corsOrigins 配置(不建议使用 *)。`,
  )
}

/**
 * fileRef 判定:plain object 且带字符串 fileId;已是 File/Blob 的不算
 * (JS 侧直呼 API 传 hydrated File 时不得二次下载)。
 */
function isFileRef(value: unknown): value is BridgeFileRef {
  if (typeof value !== 'object' || value === null) return false
  if (typeof File !== 'undefined' && value instanceof File) return false
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false
  return (
    typeof (value as {fileId?: unknown}).fileId === 'string' &&
    (value as {fileId: string}).fileId !== ''
  )
}

async function downloadFile(
  ref: BridgeFileRef,
  transport: BridgeFileTransport,
  fetchImpl: typeof fetch,
): Promise<File> {
  const url = `${transport.httpUrl}/v1/files/${ref.fileId}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {Authorization: `Bearer ${transport.token}`},
    })
  } catch {
    logCorsHint(transport, '文件下载')
    throw new AgentApiError('NETWORK_ERROR', '桥接文件下载失败(网络/CORS)', {
      retryable: true,
      details: {fileId: ref.fileId},
    })
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new AgentApiError('UNAUTHORIZED', '桥接文件下载鉴权失败', {
        details: {fileId: ref.fileId},
      })
    }
    if (response.status === 404) {
      throw new AgentApiError(
        'FILE_NOT_FOUND',
        `桥接文件不存在: ${ref.fileId}`,
        {details: {fileId: ref.fileId}},
      )
    }
    throw new AgentApiError(
      'NETWORK_ERROR',
      `桥接文件下载失败(HTTP ${response.status})`,
      {retryable: true, details: {fileId: ref.fileId}},
    )
  }
  const buffer = await response.arrayBuffer()
  // fileName/mimeType 优先取引用自带;缺省回退响应 Content-Type 与通用名
  const contentType = response.headers?.get?.('content-type')
  return new File([buffer], ref.fileName ?? 'file', {
    type: ref.mimeType ?? contentType ?? 'application/octet-stream',
  })
}

/** 解析 fetch 实现:缺省取全局;环境无 fetch 时结构化报错(不裸抛 TypeError) */
function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const impl = fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (impl === undefined) {
    throw new AgentApiError('NETWORK_ERROR', '当前环境无 fetch,无法访问桥接', {
      retryable: false,
    })
  }
  return impl
}

/**
 * 命令 args 水合:`{file:{fileId,...}}` → 下载字节构造 File 后替换;
 * 无 fileRef 的 args 原样返回(同引用,不发起请求)。失败以 AgentApiError
 * 结构化上抛——调用方(bridgeClient)据此回 error 报文,不调用领域命令。
 */
export async function hydrateCommandArgs(
  args: unknown,
  transport: BridgeFileTransport,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  if (typeof args !== 'object' || args === null) return args
  const candidate = (args as {file?: unknown}).file
  if (!isFileRef(candidate)) return args
  const file = await downloadFile(candidate, transport, resolveFetch(fetchImpl))
  return {...(args as Record<string, unknown>), file}
}

/** VideoExportResult 形状判定(带 Blob 的任务结果;不 import 具体命令模块) */
function isBlobResult(
  value: unknown,
): value is {blob: Blob; fileName: string; mimeType: string; size: number} {
  if (typeof value !== 'object' || value === null) return false
  const blob = (value as {blob?: unknown}).blob
  return typeof Blob !== 'undefined' && blob instanceof Blob
}

function isFileDescriptor(value: unknown): value is BridgeFileDescriptor {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.fileId === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.size === 'number'
  )
}

async function uploadBlob(
  result: {blob: Blob; fileName: string; mimeType: string; size: number},
  transport: BridgeFileTransport,
  fetchImpl: typeof fetch,
): Promise<BridgeFileDescriptor> {
  const url = `${transport.httpUrl}/v1/files`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${transport.token}`,
        'X-File-Name': encodeURIComponent(result.fileName),
        'Content-Type': result.mimeType || 'application/octet-stream',
      },
      body: result.blob,
    })
  } catch {
    logCorsHint(transport, '文件上传')
    throw new AgentApiError('NETWORK_ERROR', '桥接文件上传失败(网络/CORS)', {
      retryable: true,
    })
  }
  if (!response.ok) {
    throw new AgentApiError(
      'NETWORK_ERROR',
      `桥接文件上传失败(HTTP ${response.status})`,
      {retryable: true},
    )
  }
  const body = (await response.json()) as {result?: unknown}
  if (!isFileDescriptor(body?.result)) {
    throw new AgentApiError('NETWORK_ERROR', '桥接文件上传响应形状不符', {
      retryable: true,
    })
  }
  return body.result
}

/**
 * 任务结果脱水:succeeded 且 result 带 Blob → 上传到桥接,返回 result
 * 换成 {fileId,fileName,mimeType,size} 的新快照(原始快照不改写);
 * 其余快照同引用原样返回。上传失败返回 failed NETWORK_ERROR 投影
 * (result 抹除)——绝不报告成功但缺文件。本函数不抛错。
 */
export async function dehydrateJobResult(
  snapshot: JobSnapshot<unknown>,
  transport: BridgeFileTransport,
  fetchImpl?: typeof fetch,
): Promise<JobSnapshot<unknown>> {
  if (snapshot.state !== 'succeeded') return snapshot
  if (!isBlobResult(snapshot.result)) return snapshot
  const source = snapshot.result
  try {
    const descriptor = await uploadBlob(
      source,
      transport,
      resolveFetch(fetchImpl),
    )
    return {
      ...snapshot,
      result: {
        fileId: descriptor.fileId,
        fileName: descriptor.fileName,
        mimeType: descriptor.mimeType,
        size: descriptor.size,
      },
    }
  } catch (error) {
    const normalized =
      error instanceof AgentApiError
        ? error
        : new AgentApiError('NETWORK_ERROR', '桥接文件上传失败', {
            retryable: true,
          })
    const failed: JobSnapshot<unknown> = {
      ...snapshot,
      state: 'failed',
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.details !== undefined
          ? {details: normalized.details}
          : {}),
      },
    }
    // result 里的 Blob 绝不能上线:显式抹除
    delete failed.result
    return failed
  }
}
