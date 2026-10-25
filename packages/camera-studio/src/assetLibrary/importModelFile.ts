/**
 * 宿主外部模型入库:单文件兼容入口,委托 importModelFiles。
 * 放置管线只认库条目(按 id 解析 blob),外部模型必须真实入库,
 * 姿势/骨架匹配/持久化全部照常。library/deps 可注入(测试用)。
 */
import type {ImportDeps} from './importPipeline'
import {importModelFiles} from './importModelFiles'
import {getLibrary} from './library'
import type {Library} from './library'
import type {ModelEntry} from './types'

export async function importModelFile(
  file: File,
  library: Library = getLibrary(),
  deps?: ImportDeps,
): Promise<ModelEntry> {
  const [created] = await importModelFiles([file], library, deps)
  return created
}
