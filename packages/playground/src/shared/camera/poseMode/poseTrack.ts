/**
 * 姿势轨道的读取与写入通道(spec §7)。
 *
 * 读取:theatre 没有公共的轨道查询 API,经 props 指针根(内部 SheetObject)
 * 的 template.getMapOfValidSequenceTracks_forStudio 取轨道映射——与
 * createTransactionPrivateApi 内部读取同一数据源。getPointerParts 走
 * dataverse 内部注册表,单测无法伪造真指针,根解析经
 * __setPointerRootResolverForTest 注入(仅测试用)。
 *
 * 写入(spec §7.2/§7.3 两条通道):
 *   writePoseKeyframe:摆姿势保存与面板「打帧」按钮。有轨道 = scrub set
 *   (theatre 按当前 position 写贝塞尔帧,同 position 覆盖);无轨道 =
 *   transaction sequenceProp 建轨 + scrub set 写首帧——两步事务为已知
 *   限制(setPrimitivePropAsSequenced 的 trackId 随机生成,set 看不到
 *   同事务草稿里的新轨道,spec §2.4)。
 *   setPoseValue:面板库姿势应用。永不建轨:有轨道写帧、无轨道写静态,
 *   theatre track-aware set 原生行为。
 */
import {getStudioSync} from '@dreamerbird/core'
import {getPointerParts, val} from '@dreamerbird/dataverse'
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import {parsePoseValue} from './poseValue'

type InternalSheetObject = {
  template: {
    getMapOfValidSequenceTracks_forStudio: () => {
      getValue: () => Record<string, unknown>
    }
  }
}

let pointerRootResolverForTest: (() => $IntentionalAny) | null = null

/** 仅测试:getPointerParts 依赖 dataverse 内部注册表,真指针无法伪造 */
export function __setPointerRootResolverForTest(
  fn: (() => $IntentionalAny) | null,
): void {
  pointerRootResolverForTest = fn
}

function internalRoot(
  sheetObject: ISheetObject<$IntentionalAny>,
): InternalSheetObject {
  if (pointerRootResolverForTest) return pointerRootResolverForTest()
  const {root} = getPointerParts(sheetObject.props.pose as $IntentionalAny)
  // props 指针的根恒为内部 SheetObject(sheet 对象属性的定义域)
  return root as InternalSheetObject
}

export function getPoseTrackId(
  sheetObject: ISheetObject<$IntentionalAny>,
): string | undefined {
  const tree = internalRoot(sheetObject)
    .template.getMapOfValidSequenceTracks_forStudio()
    .getValue()
  const trackId = (tree as {pose?: unknown}).pose
  return typeof trackId === 'string' ? trackId : undefined
}

/** 轨道 BasicKeyframedTrack 的帧数据;无轨道回 undefined */
function poseTrackData(
  sheetObject: ISheetObject<$IntentionalAny>,
):
  | {keyframes: {byId: Record<string, {position: number; value: unknown}>}}
  | undefined {
  const trackId = getPoseTrackId(sheetObject)
  if (!trackId) return undefined
  const root = internalRoot(sheetObject) as $IntentionalAny
  const {sheetId, objectKey} = sheetObject.address
  // 与 useEditingToolsForSimpleProp.tsx:181-187 同一读取路径
  return val(
    root.template.project.pointers.historic.sheetsById[sheetId].sequence
      .tracksByObject[objectKey].trackData[trackId],
  )
}

export function getPoseKeyframePositions(
  sheetObject: ISheetObject<$IntentionalAny>,
): number[] {
  const track = poseTrackData(sheetObject)
  if (!track) return []
  return Object.values(track.keyframes.byId).map((kf) => kf.position)
}

export function getPoseKeyframeCount(
  sheetObject: ISheetObject<$IntentionalAny>,
): number {
  return getPoseKeyframePositions(sheetObject).length
}

/** 当前值 + 轨道全部帧值里的 lib 引用 id(prefetchLibPoses 的输入) */
export function collectLibPoseIds(
  sheetObject: ISheetObject<$IntentionalAny>,
): string[] {
  const ids = new Set<string>()
  const current = parsePoseValue(
    (val(sheetObject.props.pose as $IntentionalAny) as string) ?? '',
  )
  if (current?.kind === 'lib') ids.add(current.id)
  const track = poseTrackData(sheetObject)
  if (track) {
    for (const kf of Object.values(track.keyframes.byId)) {
      const v = parsePoseValue(typeof kf.value === 'string' ? kf.value : '')
      if (v?.kind === 'lib') ids.add(v.id)
    }
  }
  return [...ids]
}

export function writePoseKeyframe(
  sheetObject: ISheetObject<$IntentionalAny>,
  json: string,
): void {
  const studio = getStudioSync()
  if (!studio) return
  if (!getPoseTrackId(sheetObject)) {
    studio.transaction(({sequenceProp}) => {
      sequenceProp(sheetObject.props.pose as $IntentionalAny)
    })
  }
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(sheetObject.props.pose as $IntentionalAny, json)
    backupCustomPose(sheetObject, set, json)
  })
  scrub.commit()
}

/** 自定义快照顺手写进 poseCustom 备份属性(自定义保留可切回,2026-10-01);
 *  库引用/空值不动备份——切到预设后仍能切回最近一次自定义 */
function backupCustomPose(
  sheetObject: ISheetObject<$IntentionalAny>,
  set: (pointer: $IntentionalAny, value: $IntentionalAny) => void,
  json: string,
): void {
  if (!sheetObject.props.poseCustom) return
  if (parsePoseValue(json)?.kind !== 'custom') return
  set(sheetObject.props.poseCustom as $IntentionalAny, json)
}

export function setPoseValue(
  sheetObject: ISheetObject<$IntentionalAny>,
  json: string,
): void {
  const studio = getStudioSync()
  if (!studio) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(sheetObject.props.pose as $IntentionalAny, json)
    backupCustomPose(sheetObject, set, json)
  })
  scrub.commit()
}
