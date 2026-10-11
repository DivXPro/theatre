import {executeImport, planImport, baseName} from './importPipeline'
import type {ImportDeps} from './importPipeline'
import {backfillModelThumbnails} from './thumbnail'
import type {Library} from './library'
import type {ModelEntry} from './types'

/** 内置播种的骨架族默认别名(Mixamo 角色同一套骨骼命名,天然同族) */
export const SEED_RIG_ALIAS = 'Mixamo'

/**
 * 内置模型播种:把随包携带的模型文件导入资产库。
 * 幂等——按条目名判存:名单齐全直接返回(不解析文件,秒回);
 * 缺谁补谁,补跑时管线的内容哈希去重兜底(改名过的条目会被判
 * 「已存在」而跳过,不会长出重复条目)。similar 冲突自动选 keep,
 * 播种永远不打扰用户。
 */
export async function seedModels(
  files: File[],
  library: Library,
  deps: ImportDeps,
): Promise<void> {
  if (!files.length) return
  const existing = (await library.listEntries('model')) as ModelEntry[]
  const existingNames = new Set(existing.map((e) => e.name))
  const todo = files.filter((f) => !existingNames.has(baseName(f.name)))
  if (!todo.length) return

  const plan = await planImport(todo, library, deps)
  await executeImport(
    plan,
    plan.similar.map(() => 'keep'),
    library,
  )
  await backfillModelThumbnails(plan.items, library)

  // 同族角色给骨架族一个能看的默认名;用户已起过名的不覆盖
  const aliased = new Set((await library.getRigAliases()).map((a) => a.rig))
  for (const item of plan.items) {
    if (item.type !== 'model' || aliased.has(item.rig)) continue
    aliased.add(item.rig)
    await library.setRigAlias(item.rig, SEED_RIG_ALIAS)
  }
}
