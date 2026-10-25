import {
  executeImport,
  ImportItemWriteError,
  planImport,
  realImportDeps,
  type ImportDeps,
  type ImportItem,
} from './importPipeline'
import {getLibrary, type Library} from './library'
import type {ModelEntry} from './types'

export type ImportFileFailure = {file: string; message: string}

export class ImportModelFilesError extends Error {
  constructor(
    readonly entries: ModelEntry[],
    readonly failedItems: ImportFileFailure[],
    readonly cause: unknown,
  ) {
    super(
      `模型导入部分失败: ${failedItems
        .map((item) => `${item.file}: ${item.message}`)
        .join('; ')}`,
    )
    this.name = 'ImportModelFilesError'
  }
}

function failureOf(item: ImportItem): ImportFileFailure {
  return {
    file: item.sourceFile ?? item.name,
    message: item.type === 'skip' ? item.reason : '写入失败',
  }
}

export async function importModelFiles(
  files: File[],
  library: Library = getLibrary(),
  deps?: ImportDeps,
): Promise<ModelEntry[]> {
  const before = new Set((await library.listEntries('model')).map((e) => e.id))
  const modelFiles = files.filter((file) =>
    /\.(glb|gltf|fbx)$/i.test(file.name),
  )
  const plan = await planImport(
    modelFiles,
    library,
    deps ?? realImportDeps(files),
  )
  const failedItems = plan.items
    .filter((item) => item.type === 'skip' && !item.duplicate)
    .map(failureOf)
  let executeError: unknown
  try {
    await executeImport(
      plan,
      plan.similar.map(() => 'keep'),
      library,
    )
  } catch (error) {
    executeError = error
    if (error instanceof ImportItemWriteError) {
      const cause = error.cause
      failedItems.push({
        ...failureOf(error.item),
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } else {
      failedItems.push({
        file: 'unknown',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const entries = (await library.listEntries('model')).filter(
    (entry): entry is ModelEntry =>
      entry.kind === 'model' && !before.has(entry.id),
  )
  if (executeError || failedItems.length > 0) {
    const cause =
      executeError instanceof ImportItemWriteError
        ? executeError.cause
        : executeError
    throw new ImportModelFilesError(entries, failedItems, cause)
  }
  if (entries.length === 0) {
    throw new Error('[hostFlows] 模型导入失败:未找到新建条目')
  }
  return entries
}
