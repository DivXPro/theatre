// packages/camera-studio/src/poseNames.ts
/**
 * 姿势条目显示名解析(2026-10-05 与用户对齐):选择框/属性行只显示
 * 姿势名本身,不再上屏三段式条目名的「分类 · 」前缀与「· 左手/右手」
 * 后缀(侧由选择框标题区分,分类信息留在资产库管理页)。
 *
 * 内置种子条目(seed-pose-<key>)查 pg.poseName.<key> 词典(i18n,
 * 见 poseNameMessages.ts);查不到(用户自存姿势、词典漏词条)回退
 * 条目名原文——用户姿势的名字就是用户起的,不做拆解。
 */
export function poseEntryName(
  entry: {id: string; name: string},
  t: (k: string) => string,
): string {
  const PREFIX = 'seed-pose-'
  if (entry.id.startsWith(PREFIX)) {
    const key = 'pg.poseName.' + entry.id.slice(PREFIX.length)
    const hit = t(key)
    // translate 未命中返回 key 原文,据此判断词典有没有这条
    if (hit !== key) return hit
  }
  return entry.name
}
