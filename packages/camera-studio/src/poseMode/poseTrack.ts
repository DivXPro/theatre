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
 *   writePoseKeyframe:摆姿势退出提交。有轨道 = scrub set(theatre 按当前
 *   position 写贝塞尔帧,同 position 覆盖);无轨道 = transaction
 *   sequenceProp 建轨 + scrub set 写首帧——两步事务为已知限制
 *   (setPrimitivePropAsSequenced 的 trackId 随机生成,set 看不到同事务
 *   草稿里的新轨道,spec §2.4)。面板打帧走属性行原生打帧钮,不经这里。
 *   setPoseValue:右键菜单/弹框应用姿势。永不建轨:有轨道写帧、无轨道
 *   写静态,theatre track-aware set 原生行为。
 */
import {getStudioSync} from '@dreamerbird/core'
import {getPointerParts, val} from '@dreamerbird/dataverse'
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
// clearPoseValue 需要 stateEditors 直改 historic(公共 transaction api
// 不暴露),走内部 Studio 通道——与 agent/keyframeTracks、CameraScene
// 诊断钩子同路径
import getStudio from '@dreamerbird/studio/getStudio'
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

export function getTrackIdForProp(
  sheetObject: ISheetObject<$IntentionalAny>,
  propName: string,
): string | undefined {
  const tree = internalRoot(sheetObject)
    .template.getMapOfValidSequenceTracks_forStudio()
    .getValue()
  const trackId = (tree as Record<string, unknown>)[propName]
  return typeof trackId === 'string' ? trackId : undefined
}

export function getPoseTrackId(
  sheetObject: ISheetObject<$IntentionalAny>,
): string | undefined {
  return getTrackIdForProp(sheetObject, 'pose')
}

/** 轨道 BasicKeyframedTrack 的帧数据;无轨道回 undefined */
function propTrackData(
  sheetObject: ISheetObject<$IntentionalAny>,
  propName: string,
):
  | {keyframes: {byId: Record<string, {position: number; value: unknown}>}}
  | undefined {
  const trackId = getTrackIdForProp(sheetObject, propName)
  if (!trackId) return undefined
  const root = internalRoot(sheetObject) as $IntentionalAny
  const {sheetId, objectKey} = sheetObject.address
  // 与 useEditingToolsForSimpleProp.tsx:181-187 同一读取路径
  return val(
    root.template.project.pointers.historic.sheetsById[sheetId].sequence
      .tracksByObject[objectKey].trackData[trackId],
  )
}

function poseTrackData(
  sheetObject: ISheetObject<$IntentionalAny>,
):
  | {keyframes: {byId: Record<string, {position: number; value: unknown}>}}
  | undefined {
  return propTrackData(sheetObject, 'pose')
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
  return collectLibPoseIdsForProps(sheetObject, ['pose'])
}

/** 多属性版(姿势 + 左手势/右手势):一并收集,预取一次全覆盖 */
export function collectLibPoseIdsForProps(
  sheetObject: ISheetObject<$IntentionalAny>,
  propNames: string[],
): string[] {
  const ids = new Set<string>()
  for (const propName of propNames) {
    const current = parsePoseValue(
      (val(sheetObject.props[propName] as $IntentionalAny) as string) ?? '',
    )
    if (current?.kind === 'lib') ids.add(current.id)
    const track = propTrackData(sheetObject, propName)
    if (track) {
      for (const kf of Object.values(track.keyframes.byId)) {
        const v = parsePoseValue(typeof kf.value === 'string' ? kf.value : '')
        if (v?.kind === 'lib') ids.add(v.id)
      }
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
  })
  scrub.commit()
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
  })
  scrub.commit()
}

/**
 * 清除姿势值与轨道(CameraScene 清除按钮与 Agent poses.clear 共用):
 * 单个事务 = 一个撤销步骤。经内部 Studio 的 stateEditors 直改 historic:
 * setPrimitivePropAsStatic(有轨时把当前值落为静态)紧接着
 * unsetValueOfPrimitiveProp(删掉落下来的静态)——两个编辑器都是幂等直写,
 * 不经指针读轨道树,绕开「单事务里 unsequenceProp 后 unset(pointer) 读到
 * 事务前轨道树、错走删播放头帧分支」的指针级限制(2026-10-01 冒烟记录),
 * 无需拆两事务。行为由 agent/commands/poses.realStudio.test.ts 验证
 * (删轨+清值一步撤销,undo 一并恢复)。
 *
 * 返回 'cleared' | 'empty' | 'unavailable':空姿势(无轨无静态)不开空事务,
 * 调用方据此返回明确结果而非静默 no-op;Studio 不可用由调用方决定
 * 报错(Agent SCENE_UNAVAILABLE)还是静默(UI)。
 */
export function clearPoseValue(
  sheetObject: ISheetObject<$IntentionalAny>,
): 'cleared' | 'empty' | 'unavailable' {
  const studio = getStudio()
  if (!studio) return 'unavailable'
  const hadTrack = Boolean(getPoseTrackId(sheetObject))
  const current =
    (val(sheetObject.props.pose as $IntentionalAny) as string) ?? ''
  if (!hadTrack && current === '') return 'empty'
  studio.transaction(({stateEditors}) => {
    const editors = stateEditors.coreByProject.historic.sheetsById
    const address = {
      projectId: sheetObject.address.projectId,
      sheetId: sheetObject.address.sheetId,
      objectKey: sheetObject.address.objectKey,
      pathToProp: ['pose'],
    }
    if (hadTrack) {
      // 先把当前求值落为静态(编辑器语义),随即删掉——净效果=回默认绑定
      editors.sequence.setPrimitivePropAsStatic({...address, value: current})
    }
    editors.staticOverrides.byObject.unsetValueOfPrimitiveProp(address)
  })
  return 'cleared'
}
