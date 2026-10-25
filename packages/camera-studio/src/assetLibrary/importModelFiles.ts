import {
  executeImport,
  planImport,
  realImportDeps,
  type ImportDeps,
} from './importPipeline'
import {getLibrary, type Library} from './library'
import type {ModelEntry} from './types'

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
  await executeImport(
    plan,
    plan.similar.map(() => 'keep'),
    library,
  )
  const created = (await library.listEntries('model')).filter(
    (entry): entry is ModelEntry =>
      entry.kind === 'model' && !before.has(entry.id),
  )
  if (created.length === 0) {
    throw new Error('[hostFlows] 模型导入失败:未找到新建条目')
  }
  return created
}
