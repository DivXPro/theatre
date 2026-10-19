/**
 * assets.*(2026-10-17,Task 8):资产库查询与写入。
 *
 * 资产不属于 Theatre undo(spec 8.6.4):全部 undoable:none、
 * stateDomain:asset,也不用项目 revision 伪装并发保护(spec 8.5)。
 * rename/delete 直等 Library 完成并返回更新后的条目 / {deleted:true};
 * 无 writable 源或条目属于只读源时返回 INVALID_STATE,不静默成功。
 *
 * importModel 是任务型命令(kind:job, completion:loaded):经
 * runtime.jobs.start 调用 importModelFile(file, library),任务结果即
 * ModelEntry;管线逐项落库,中途失败时 diff 出已创建条目,报
 * PARTIAL_FAILURE(details 含 createdAssetIds 与失败项);Library 的
 * quota/network 等结构化错误分别保留为 STORAGE_ERROR / NETWORK_ERROR,
 * 不统一吞成 unknown。
 *
 * 二进制契约(preflight ruling):JS 参数是 hydrated File;inputSchema
 * 描述 HTTP 的 fileRef({fileId, fileName?, mimeType?})供 schema 发现,
 * 但 registry validator 只收 File —— fileId→File 是桥接职责,原始
 * fileRef 不许绕过传输适配直接进入 Library。
 */
import {importModelFile} from '../../assetLibrary/importModelFile'
import {LibraryError} from '../../assetLibrary/source'
import type {Library} from '../../assetLibrary/library'
import type {
  EntryKind,
  LibraryEntry,
  ModelEntry,
} from '../../assetLibrary/types'
import {AgentApiError, asAgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireObject, requireString} from '../validation'

/** 资产门面(Task 15 由同名命令转发实现) */
export type AssetsApi = {
  list(args?: {kind?: EntryKind}): Promise<LibraryEntry[]>
  get(args: {assetId: string}): Promise<LibraryEntry>
  importModel(args: {file: File}): Promise<{jobId: string}>
  rename(args: {assetId: string; name: string}): Promise<LibraryEntry>
  delete(args: {assetId: string}): Promise<{deleted: true}>
}

const ENTRY_KINDS = ['model', 'pose', 'animation'] as const

/** LibraryEntry 通用形状(list/get/rename 输出) */
const libraryEntrySchema: JsonSchema = {
  type: 'object',
  description: '资产库条目(模型/姿势/动画共用外壳,各 kind 另有专属字段)',
  properties: {
    id: {type: 'string'},
    kind: {enum: ENTRY_KINDS},
    name: {type: 'string'},
    rig: {type: 'string'},
    createdAt: {type: 'number'},
  },
  required: ['id', 'kind', 'name'],
}

/** ModelEntry 形状(importModel 的 jobResult) */
const modelEntrySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    kind: {enum: ['model']},
    name: {type: 'string'},
    rig: {type: 'string'},
    blobId: {type: 'string'},
    contentHash: {type: 'string'},
    thumbnailId: {type: 'string'},
    boneCount: {type: 'number'},
    vertexCount: {type: 'number'},
    createdAt: {type: 'number'},
  },
  required: [
    'id',
    'kind',
    'name',
    'rig',
    'blobId',
    'contentHash',
    'boneCount',
    'vertexCount',
    'createdAt',
  ],
}

const listInput: JsonSchema = {
  type: 'object',
  properties: {
    kind: {enum: ENTRY_KINDS, description: '按条目类型过滤;缺省返回全部'},
  },
  additionalProperties: false,
}

const assetIdInput: JsonSchema = {
  type: 'object',
  properties: {
    assetId: {type: 'string', description: '资产条目 id'},
  },
  required: ['assetId'],
  additionalProperties: false,
}

const renameInput: JsonSchema = {
  type: 'object',
  properties: {
    assetId: {type: 'string', description: '资产条目 id'},
    name: {type: 'string', description: '新名称(非空)'},
  },
  required: ['assetId', 'name'],
  additionalProperties: false,
}

/** HTTP 传输形状:桥接把 fileId 水合成 File 后才进 validator */
const importModelInput: JsonSchema = {
  type: 'object',
  properties: {
    file: {
      type: 'object',
      description:
        'HTTP:经 POST /v1/files 上传后的引用;JS:直接传 hydrated File',
      properties: {
        fileId: {type: 'string', description: '桥接上传返回的文件 id'},
        fileName: {type: 'string'},
        mimeType: {type: 'string'},
      },
      required: ['fileId'],
      additionalProperties: false,
    },
  },
  required: ['file'],
  additionalProperties: false,
}

const jobIdOutput: JsonSchema = {
  type: 'object',
  properties: {jobId: {type: 'string'}},
  required: ['jobId'],
}

const deletedOutput: JsonSchema = {
  type: 'object',
  properties: {deleted: {enum: [true]}},
  required: ['deleted'],
}

/**
 * Library 结构化错误 → Agent 错误码:auth/配额/网络/冲突各有归属,
 * 原始 message 保留在 details.cause;非 LibraryError 交给通用归一。
 */
export function mapLibraryError(error: unknown): AgentApiError {
  if (error instanceof LibraryError) {
    const details = {cause: error.message}
    switch (error.code) {
      case 'auth':
        return new AgentApiError('INVALID_STATE', error.message, {details})
      case 'quota':
        return new AgentApiError('STORAGE_ERROR', error.message, {details})
      case 'network':
        return new AgentApiError('NETWORK_ERROR', error.message, {
          retryable: true,
          details,
        })
      case 'not-found':
        return new AgentApiError('ASSET_NOT_FOUND', error.message, {details})
      case 'conflict':
        return new AgentApiError('INVALID_STATE', error.message, {details})
      default:
        return new AgentApiError('INTERNAL_ERROR', error.message, {details})
    }
  }
  return asAgentApiError(error)
}

/** validator:只收 hydrated File;原始 fileRef 必须由桥接先水合 */
function requireFile(value: unknown): File {
  if (typeof File !== 'undefined' && value instanceof File) return value
  throw new AgentApiError(
    'INVALID_ARGUMENT',
    'file 必须是 File(HTTP 调用先经桥接上传拿 fileId,由桥接水合成 File)',
  )
}

function requireWritable(library: Library): void {
  if (!library.canWrite) {
    throw new AgentApiError(
      'INVALID_STATE',
      '资产库为纯查看器模式:未配置可写存储',
    )
  }
}

/**
 * 取条目并校验可写归属:不存在 ASSET_NOT_FOUND;属于只读源(内置目录等)
 * INVALID_STATE —— Library.renameEntry 对只读条目只是上告 conflict 后
 * 静默返回,命令层必须拦住,不能把它报成成功。
 * (getEntry 探源命中会回填 entrySourceMap,此处 getEntrySource 一定已覆盖)
 */
async function requireWritableEntry(
  library: Library,
  assetId: string,
): Promise<LibraryEntry> {
  const entry = await library.getEntry(assetId)
  if (!entry) {
    throw new AgentApiError('ASSET_NOT_FOUND', `资产不存在: ${assetId}`, {
      details: {assetId},
    })
  }
  const source = library.getEntrySource(assetId)
  if (source && source !== library.writable) {
    throw new AgentApiError(
      'INVALID_STATE',
      `条目 ${assetId} 属于只读数据源(${source.id}),不可写`,
      {details: {assetId, sourceId: source.id}},
    )
  }
  return entry
}

/**
 * 导入失败的结构化描述:导入管线逐项落库,中途失败时 diff 出本任务
 * 已创建的条目报 PARTIAL_FAILURE;无部分写入时按错误类型映射。
 */
async function describeImportFailure(
  library: Library,
  before: ReadonlySet<string>,
  file: File,
  error: unknown,
): Promise<AgentApiError> {
  let createdAssetIds: string[] = []
  try {
    createdAssetIds = (await library.listEntries())
      .filter((entry) => !before.has(entry.id))
      .map((entry) => entry.id)
  } catch {
    // 连列举都失败时不掩盖原始错误
  }
  const cause = error instanceof Error ? error.message : String(error)
  if (createdAssetIds.length > 0) {
    return new AgentApiError(
      'PARTIAL_FAILURE',
      `模型导入部分完成后中断: ${cause}`,
      {
        details: {
          createdAssetIds,
          failedItems: [{file: file.name, message: cause}],
        },
      },
    )
  }
  return mapLibraryError(error)
}

export function registerAssetCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<{kind?: EntryKind}, LibraryEntry[]>({
    name: 'assets.list',
    kind: 'query',
    stateDomain: 'asset',
    undoable: 'none',
    inputSchema: listInput,
    outputSchema: {type: 'array', items: libraryEntrySchema},
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: (value) => {
      const args =
        value === undefined || value === null ? {} : requireObject(value)
      if (args.kind === undefined) return {}
      if (
        typeof args.kind !== 'string' ||
        !(ENTRY_KINDS as readonly string[]).includes(args.kind)
      ) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `kind 必须是 ${ENTRY_KINDS.join(' / ')} 之一`,
        )
      }
      return {kind: args.kind as EntryKind}
    },
    execute: async (args) => {
      runtime.assertActive()
      return runtime.library.listEntries(args.kind)
    },
  })

  registry.register<{assetId: string}, LibraryEntry>({
    name: 'assets.get',
    kind: 'query',
    stateDomain: 'asset',
    undoable: 'none',
    inputSchema: assetIdInput,
    outputSchema: libraryEntrySchema,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'ASSET_NOT_FOUND'],
    validate: (value) => ({
      assetId: requireString(requireObject(value), 'assetId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      const entry = await runtime.library.getEntry(args.assetId)
      if (!entry) {
        throw new AgentApiError(
          'ASSET_NOT_FOUND',
          `资产不存在: ${args.assetId}`,
          {
            details: {assetId: args.assetId},
          },
        )
      }
      return entry
    },
  })

  registry.register<{file: File}, {jobId: string}>({
    name: 'assets.importModel',
    kind: 'job',
    stateDomain: 'asset',
    undoable: 'none',
    completion: 'loaded',
    cancelable: false,
    inputSchema: importModelInput,
    outputSchema: jobIdOutput,
    jobResultSchema: modelEntrySchema,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_STATE',
      'STORAGE_ERROR',
      'NETWORK_ERROR',
      'PARTIAL_FAILURE',
      'INTERNAL_ERROR',
    ],
    validate: (value) => ({file: requireFile(requireObject(value).file)}),
    execute: async (args) => {
      runtime.assertActive()
      // 纯查看器模式直接拒绝,不起任务
      requireWritable(runtime.library)
      const library = runtime.library
      const {jobId} = runtime.jobs.start<ModelEntry>({
        kind: 'assets.importModel',
        cancelable: false,
        execute: async (controls) => {
          // 部分写入检测的底账:导入前的全量条目 id
          const before = new Set(
            (await library.listEntries()).map((entry) => entry.id),
          )
          try {
            const entry = await importModelFile(args.file, library)
            // 资源(GLB + 条目)已入库:声明的完成阶段
            controls.update({phase: 'loaded'})
            return entry
          } catch (error) {
            throw await describeImportFailure(library, before, args.file, error)
          }
        },
      })
      return {jobId}
    },
  })

  registry.register<{assetId: string; name: string}, LibraryEntry>({
    name: 'assets.rename',
    kind: 'mutation',
    stateDomain: 'asset',
    undoable: 'none',
    inputSchema: renameInput,
    outputSchema: libraryEntrySchema,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'ASSET_NOT_FOUND',
      'INVALID_STATE',
      'STORAGE_ERROR',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        assetId: requireString(args, 'assetId'),
        name: requireString(args, 'name'),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const library = runtime.library
      requireWritable(library)
      await requireWritableEntry(library, args.assetId)
      try {
        await library.renameEntry(args.assetId, args.name)
      } catch (error) {
        throw mapLibraryError(error)
      }
      const updated = await library.getEntry(args.assetId)
      if (!updated) {
        throw new AgentApiError(
          'INTERNAL_ERROR',
          `重命名后条目不可读: ${args.assetId}`,
          {details: {assetId: args.assetId}},
        )
      }
      return updated
    },
  })

  registry.register<{assetId: string}, {deleted: true}>({
    name: 'assets.delete',
    kind: 'mutation',
    stateDomain: 'asset',
    undoable: 'none',
    inputSchema: assetIdInput,
    outputSchema: deletedOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'ASSET_NOT_FOUND',
      'INVALID_STATE',
      'STORAGE_ERROR',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
    ],
    validate: (value) => ({
      assetId: requireString(requireObject(value), 'assetId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      const library = runtime.library
      requireWritable(library)
      await requireWritableEntry(library, args.assetId)
      try {
        // 深删:条目 + 独占 blob(被其他条目共享的 blob 由 Library 保留)
        await library.deleteEntryDeep(args.assetId)
      } catch (error) {
        throw mapLibraryError(error)
      }
      return {deleted: true}
    },
  })
}
