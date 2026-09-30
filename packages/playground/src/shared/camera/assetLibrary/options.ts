import type {LibraryEntry} from './types'

/**
 * 动作/姿势下拉选项:值是库条目 id(与放置模型属性里存的值一致),
 * 标签是条目名,另带一个空值选项表示"不挂"。
 * 模型条目 id 能解析出骨架族时只列同族条目(别的族的动作/姿势挂不上);
 * 解析不了(本地 FBX 来源、快照尚未就绪)时不设限,列出全部。
 */
export function entryOptions(
  entries: readonly LibraryEntry[],
  kind: 'animation' | 'pose',
  modelEntryId: string | undefined,
): Record<string, string> {
  const rig = modelEntryId
    ? entries.find((e) => e.id === modelEntryId && e.kind === 'model')?.rig
    : undefined
  const options: Record<string, string> = {'': '(无)'}
  for (const e of entries) {
    if (e.kind !== kind) continue
    if (rig && e.rig !== rig) continue
    options[e.id] = e.name
  }
  return options
}
