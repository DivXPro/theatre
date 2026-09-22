/**
 * 宿主外部模型入库:File → 既有导入管线(planImport/executeImport)。
 * 放置管线只认库条目(按 id 解析 blob),外部模型必须真实入库,
 * 姿势/骨架匹配/持久化全部照常。library/deps 可注入(测试用)。
 */
import {planImport, executeImport, realImportDeps} from './importPipeline'
import type {ImportDeps} from './importPipeline'
import {getLibrary} from './library'
import type {Library} from './library'
import type {ModelEntry} from './types'

export async function importModelFile(
  file: File,
  library: Library = getLibrary(),
  deps: ImportDeps = realImportDeps(),
): Promise<ModelEntry> {
  const before = new Set(
    (await library.backend.listEntries('model')).map((e) => e.id),
  )
  const plan = await planImport([file], library.backend, deps)
  // 宿主场景无"相似条目"交互,一律保留为新条目
  await executeImport(
    plan,
    plan.similar.map(() => 'keep'),
    library,
  )
  const models = await library.backend.listEntries('model')
  const created = models.find((m) => !before.has(m.id))
  if (!created || created.kind !== 'model') {
    throw new Error('[hostFlows] 模型导入失败:未找到新建条目')
  }
  return created
}
