// packages/playground/src/shared/camera/gestureProps.ts
/**
 * 手势属性(2026-10-05,左手势/右手势):姿势属性的「纯选择」版——
 * 值只能是库手势引用或「无手势」,没有自定义快照入口(不挂姿势模式);
 * 可打帧(复用姿势插值器,帧间手指平滑过渡)。
 *
 * 应用语义 = 叠加层:姿势层(全身,含手指)先写,手势层后写且只写本侧
 * 手指骨——身体与另一只手绝不被手势触碰;清掉手势后手指由姿势层
 * (或绑定姿势)自然归位,因为应用链每次都先整写姿势层。
 *
 * 手势条目判定按数据形状:bones 全是手指骨(不含手腕/躯干)的库姿势。
 * 注意 QBX 手势条目左右手骨都带(未动侧是 rest 方向),所以分两层过滤:
 *   列表:按名字侧(「· 左手/· 右手」后缀;无后缀 = 双手手势,两侧都列)
 *   应用:按骨名 Left/Right 侧过滤,只写本侧 15 根手指骨
 * 列表管 UX,骨过滤管正确性,各管各的。
 *
 * 姿势选择框与手势选择框的分家也走 isHandPoseEntry:手势条目只进手势
 * 框,姿势框回归纯身体姿势(2026-10-05 与用户对齐)。
 */
import type {PoseEntry} from './assetLibrary/types'
import type {PoseBones} from './poseMode/poseOverride'
import {defaultT as translate} from './i18n'
import {poseInterpolate} from './poseMode/poseInterpolate'
import {resolvePoseBones} from './poseMode/poseLibResolve'
import {parsePoseValue} from './poseMode/poseValue'

export type GestureSide = 'left' | 'right'

/** Mixamo 系手指骨:…Hand+指名+节号(如 LeftHandThumb1);手腕(裸 …Hand)不匹配 */
const FINGER_BONE = /Hand(?:Thumb|Index|Middle|Ring|Pinky)\d+$/
const SIDE_TOKEN: Record<GestureSide, string> = {
  left: 'LeftHand',
  right: 'RightHand',
}

export function isFingerBoneName(name: string): boolean {
  return FINGER_BONE.test(name)
}

/** 手势条目判定:非空且每根骨都是手指骨(全身姿势含躯干骨,天然排除) */
export function isHandPoseEntry(entry: {bones?: PoseBones}): boolean {
  const keys = Object.keys(entry.bones ?? {})
  return keys.length > 0 && keys.every(isFingerBoneName)
}

/** 应用侧过滤:只留本侧手指骨(条目里另一侧的 rest 手指骨被裁掉) */
export function filterGestureBonesBySide(
  bones: PoseBones,
  side: GestureSide,
): PoseBones {
  const token = SIDE_TOKEN[side]
  return Object.fromEntries(
    Object.entries(bones).filter(([name]) => name.includes(token)),
  )
}

/** 条目名字侧:「· 左手/· 右手」后缀;无后缀 = 双手手势 */
export function gestureEntryNameSide(name: string): GestureSide | null {
  if (name.endsWith('· 左手')) return 'left'
  if (name.endsWith('· 右手')) return 'right'
  return null
}

/**
 * 解析手势值 → 本侧手指骨(应用层的唯一入口)。
 * 空值/解析不出/该侧无骨 → null(跳过应用,手指保持姿势层状态)。
 * 求值产物可能是 custom 快照(打帧插值),parse/resolve 通吃,无需特判。
 */
export function resolveGestureBones(
  gestureJson: string,
  side: GestureSide,
): PoseBones | null {
  const bones = resolvePoseBones(parsePoseValue(gestureJson))
  if (!bones) return null
  const filtered = filterGestureBonesBySide(bones, side)
  return Object.keys(filtered).length > 0 ? filtered : null
}

/** 手势属性的注册形态:与姿势同构(string + 编辑器 key + 自定义插值器),
 *  但编辑器只给选择(无手势/库手势),没有自定义入口 */
export function gesturePropConfigShape(side: GestureSide): {
  defaultValue: string
  opts: {
    label: () => string
    editor: string
    interpolate: typeof poseInterpolate
  }
} {
  return {
    defaultValue: '',
    opts: {
      label: () =>
        translate(side === 'left' ? 'pg.props.gestureL' : 'pg.props.gestureR'),
      editor: side === 'left' ? 'gestureL' : 'gestureR',
      interpolate: poseInterpolate,
    },
  }
}

// ── 选择框选项与显示文本(纯函数,便于单测) ──────────────────────────

export type GestureOptionKey = 'none' | `lib:${string}`

export type GestureOption = {
  key: GestureOptionKey
  label: string
  disabled?: boolean
  hint?: string
  /** 缩略图 URL(条目带 thumbnailId 且解析完成时由调用方注入) */
  thumbUrl?: string
}

/**
 * 手势选择框选项:「无手势」永远第一项;往下是本侧(或双手)手势条目,
 * 异族置灰。当前值引用已删条目时追加置灰缺失项如实显示。
 * 值本不该是 custom(无自定义入口),但打帧插值产物/手工粘贴可能出现——
 * current 如实报 'custom'(列表无对应高亮项,与姿势框同处理)。
 */
export function buildGestureOptions(args: {
  gestureJson: string
  libEntries: Pick<PoseEntry, 'id' | 'name' | 'rig' | 'bones' | 'thumbnailId'>[]
  side: GestureSide
  /** 当前选中模型的骨架族;缺省=不过滤 */
  selectedRig?: string
  /** 缩略图 URL 解析(懒加载 hook 的 getThumbUrl);缺省=无图 */
  thumbUrlOf?: (entry: {id: string; thumbnailId?: string}) => string | undefined
  /** 显示名解析(poseEntryName:种子条目查 i18n 词典);缺省=条目名原文 */
  nameOf?: (entry: {id: string; name: string}) => string
  t: (k: string) => string
}): {options: GestureOption[]; current: GestureOptionKey | 'custom'} {
  const {gestureJson, libEntries, side, selectedRig, thumbUrlOf, nameOf, t} =
    args
  const currentValue = parsePoseValue(gestureJson)
  const current: GestureOptionKey | 'custom' = !currentValue
    ? 'none'
    : currentValue.kind === 'custom'
      ? 'custom'
      : `lib:${currentValue.id}`

  const options: GestureOption[] = [{key: 'none', label: t('pg.gesture.none')}]
  const listed = new Set<string>()
  for (const entry of libEntries) {
    if (!isHandPoseEntry(entry)) continue
    const nameSide = gestureEntryNameSide(entry.name)
    if (nameSide !== null && nameSide !== side) continue
    listed.add(entry.id)
    const rigMismatch = selectedRig !== undefined && entry.rig !== selectedRig
    const thumbUrl = thumbUrlOf?.(entry)
    options.push({
      key: `lib:${entry.id}`,
      label: nameOf?.(entry) ?? entry.name,
      disabled: rigMismatch || undefined,
      hint: rigMismatch ? t('pg.lib.rigMismatch') : undefined,
      ...(thumbUrl ? {thumbUrl} : {}),
    })
  }
  if (currentValue?.kind === 'lib' && !listed.has(currentValue.id)) {
    options.push({
      key: `lib:${currentValue.id}`,
      label: currentValue.id,
      disabled: true,
      hint: t('pg.pose.libMissing'),
    })
  }
  return {options, current}
}

/** 手势属性行值区域显示文本:空值「无手势」;库引用 → 条目名(缺失带标记);
 *  custom(打帧插值产物/手工粘贴,本编辑器不产生)→ 自定义姿势 */
export function gestureDisplayText(args: {
  gestureJson: string
  libEntries: Pick<PoseEntry, 'id' | 'name'>[]
  /** 显示名解析(poseEntryName:种子条目查 i18n 词典);缺省=条目名原文 */
  nameOf?: (entry: {id: string; name: string}) => string
  t: (k: string) => string
}): string {
  const {gestureJson, libEntries, nameOf, t} = args
  const value = parsePoseValue(gestureJson)
  if (!value) return t('pg.gesture.none')
  if (value.kind === 'custom') return t('pg.pose.statusCustom')
  const entry = libEntries.find((e) => e.id === value.id)
  return entry
    ? nameOf?.(entry) ?? entry.name
    : `${value.id}${t('pg.pose.libMissing')}`
}
