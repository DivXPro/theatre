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
 *   writePoseKeyframe:在一个事务内迁移旧静态值、建轨、写帧。
 *   setPoseValue:右键菜单/弹框应用姿势。永不建轨:有轨道写帧、无轨道
 *   写静态,theatre track-aware set 原生行为。
 */
import {__private, getStudioSync} from '@dreamerbird/core'
import {getPointerParts, val} from '@dreamerbird/dataverse'
import type {ISheetObject} from '@dreamerbird/core'
import type {
  $IntentionalAny,
  KeyframeId,
  SequenceTrackId,
} from '@dreamerbird/core/types/public'
import type {HistoricPositionalSequence} from '@dreamerbird/core/types/private'
// clearPoseValue 需要 stateEditors 直改 historic(公共 transaction api
// 不暴露),走内部 Studio 通道——与 agent/keyframeTracks、CameraScene
// 诊断钩子同路径
import getStudio from '@dreamerbird/studio/getStudio'
import {encodePathToProp} from '@dreamerbird/utils/pathToProp'
import type {Group} from 'three'
import {capturePose} from '../assetLibrary/pose'
import {determinePoseFrameMode} from './poseFrame'
import type {PoseFrameMode} from './poseFrame'
import type {PoseSession, PoseSessionTarget} from './poseSession'
import {parsePoseValue, serializeCustomPose} from './poseValue'

type InternalSheetObject = {
  template: {
    getDefaultValues: () => {getValue: () => Record<string, unknown>}
    getStaticValues: () => {getValue: () => Record<string, unknown> | undefined}
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

function getLegacyDefaultPose(
  sheetObject: ISheetObject<$IntentionalAny>,
): string {
  if (getPoseKeyframeCount(sheetObject) > 0) return ''
  const value = internalRoot(sheetObject).template.getStaticValues().getValue()
    ?.pose
  return typeof value === 'string' ? value : ''
}

export function resolveDefaultPose(
  sheetObject: ISheetObject<$IntentionalAny>,
): string {
  const stored = internalRoot(sheetObject).template.getStaticValues().getValue()
    ?.defaultPose
  return typeof stored === 'string' ? stored : getLegacyDefaultPose(sheetObject)
}

export function writeDefaultPose(
  sheetObject: ISheetObject<$IntentionalAny>,
  json: string,
): void {
  const studio = getStudio()
  if (
    !studio ||
    typeof internalRoot(sheetObject).template.getDefaultValues().getValue()
      .defaultPose !== 'string'
  )
    return
  const address = {...sheetObject.address, pathToProp: ['defaultPose']}
  studio.transaction(({stateEditors}) => {
    const editors = stateEditors.coreByProject.historic.sheetsById
    editors.sequence.setPrimitivePropAsStatic({...address, value: json})
    editors.staticOverrides.byObject.setValueOfPrimitiveProp({
      ...address,
      value: json,
    })
  })
}

export type PreparePose = (target: PoseSessionTarget, position: number) => void

export function preparePoseSession(
  session: PoseSession,
  instance: Group,
  object: ISheetObject<$IntentionalAny>,
  preparePose?: PreparePose,
): PoseFrameMode | null {
  if (session.target === 'draft') {
    session.draft.applyPreview?.(instance)
    return null
  }
  const sequence = object.sheet.sequence
  if (session.target === 'static') {
    preparePose?.('static', sequence.position)
    return null
  }
  const frame = determinePoseFrameMode(
    getPoseKeyframePositions(object),
    session.position ?? sequence.position,
    (position) => sequence.closestGridPosition(position),
  )
  sequence.position = frame.position
  preparePose?.('scene', frame.position)
  return frame
}

export function commitPoseSession(
  session: PoseSession,
  instance: Group,
  object: ISheetObject<$IntentionalAny>,
  frame: PoseFrameMode | null,
): void {
  const bones = capturePose(instance)
  if (session.target === 'draft') {
    session.draft.onCapture(bones)
  } else if (session.target === 'static') {
    writeDefaultPose(object, serializeCustomPose(bones))
  } else if (frame) {
    object.sheet.sequence.position = frame.position
    writePoseKeyframe(object, serializeCustomPose(bones))
  }
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
  const studio = getStudio()
  if (!studio) return
  const address = sheetObject.address
  const pathToProp = ['pose']
  const sequence = sheetObject.sheet.sequence
  const position = sequence.closestGridPosition(sequence.position)
  const template = internalRoot(sheetObject).template
  const existingTrackId = getPoseTrackId(sheetObject)
  const storedDefaultPose = template.getStaticValues().getValue()?.defaultPose
  const defaultPose =
    storedDefaultPose === undefined &&
    typeof template.getDefaultValues().getValue().defaultPose === 'string' &&
    getPoseKeyframeCount(sheetObject) === 0
      ? getLegacyDefaultPose(sheetObject)
      : ''

  studio.transaction(({stateEditors}) => {
    const editors = stateEditors.coreByProject.historic.sheetsById
    if (defaultPose) {
      editors.staticOverrides.byObject.setValueOfPrimitiveProp({
        ...address,
        pathToProp: ['defaultPose'],
        value: defaultPose,
      })
    }
    const path = encodePathToProp(pathToProp)
    if (!existingTrackId) {
      editors.sequence.setPrimitivePropAsSequenced({...address, pathToProp})
      const draft = editors.sequence._ensure(
        address,
      ) as unknown as HistoricPositionalSequence
      const tracks = draft.tracksByObject[address.objectKey]!
      const trackId = tracks.trackIdByPropPath[path]!
      const track = tracks.trackData[trackId]!
      track.keyframes = __private.keyframeUtils.fromArray([
        {
          id: trackId as string as KeyframeId,
          position,
          value: json,
          connectedRight: true,
          handles: [0.5, 1, 0.5, 0],
          type: 'bezier',
        },
      ])
    } else {
      editors.sequence.setKeyframeAtPosition({
        ...address,
        trackId: existingTrackId as SequenceTrackId,
        position,
        value: json,
        snappingFunction: (time) => sequence.closestGridPosition(time),
        type: 'bezier',
      })
    }
  })
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
