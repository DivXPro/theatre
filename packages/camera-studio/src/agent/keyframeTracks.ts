/**
 * 关键帧轨道适配(2026-10-17,Task 7):keyframes.* 命令的唯一 core/Studio
 * 访问点,命令层不直接触碰 Studio state。集中三件事:
 *
 *   1. track map 读取:内部 SheetObject template 的
 *      getMapOfValidSequenceTracks_forStudio(与 poseTrack.getTrackIdForProp、
 *      useEditingToolsForSimpleProp 同一数据源)+ sheet.sequence.getKeyframes
 *      取帧 id/位置;
 *   2. 播放头定位:写 sequence.position(core 语义,先 pause + clamp);
 *   3. 事务写入:内部 Studio(`@dreamerbird/studio/getStudio`,与
 *      TransportBar/CameraPath 同路径)的 transaction,api 携带 set/unset
 *      与 stateEditors;transformKeyframes 的参数形状抽自
 *      AggregateKeyframeConnector.tsx:167-186(keyframeIds + translate +
 *      scale:1 + origin:0 + snappingFunction=sequence.closestGridPosition)。
 *
 * 事务回调同步执行,不跨 await;Studio 未初始化抛 SCENE_UNAVAILABLE。
 */
import {getPointerParts} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {
  $IntentionalAny,
  KeyframeId,
  SequenceTrackId,
  SheetObjectAddress,
} from '@dreamerbird/core/types/public'
import getStudio from '@dreamerbird/studio/getStudio'
import getDeep from '../getDeep'
import {AgentApiError} from './errors'
import {getSimplePropPointer} from './propAccess'

/** 单帧摘要:list 的输出元素(不暴露内部 id) */
export type KeyframeInfo = {position: number; value: unknown}

/** move/delete 的源帧定位结果:轨道 id + 帧 id */
export type KeyframeTarget = {trackId: string; keyframeId: string}

/** 内部 SheetObject 的轨道映射读取面(与 poseTrack 同形状) */
type InternalSheetObject = {
  template: {
    getMapOfValidSequenceTracks_forStudio: () => {
      getValue: () => Record<string, unknown>
    }
  }
}

function requireStudio(): ReturnType<typeof getStudio> {
  const studio = getStudio()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用,无法操作关键帧')
  }
  return studio
}

function leafPointer(
  obj: ISheetObject<$IntentionalAny>,
  propPath: string[],
): Pointer<$IntentionalAny> {
  return getSimplePropPointer(obj, propPath.join('.'))
}

/** 叶子路径的轨道 id(未建轨返回 undefined);数据源同 getTrackIdForProp */
function getTrackIdForPath(
  pointer: Pointer<$IntentionalAny>,
  propPath: string[],
): string | undefined {
  const {root} = getPointerParts(pointer)
  const tree = (root as InternalSheetObject).template
    .getMapOfValidSequenceTracks_forStudio()
    .getValue()
  const trackId = getDeep(tree, propPath)
  return typeof trackId === 'string' ? trackId : undefined
}

/** 指定简单叶子的全部关键帧(位置升序),未建轨返回空数组 */
export function listKeyframes(
  sheet: ISheet,
  obj: ISheetObject<$IntentionalAny>,
  propPath: string[],
): KeyframeInfo[] {
  return sheet.sequence
    .getKeyframes(leafPointer(obj, propPath) as Pointer<{}>)
    .map((kf) => ({position: kf.position, value: kf.value}))
}

/**
 * 定位指定位置(调用方已按 snap 规则处理好)的关键帧;无轨道或该位置
 * 无帧返回 undefined。位置为精确相等:轨道上的帧位置恒为网格吸附值,
 * 网格外的查询位置必然落空。
 */
export function findKeyframeAt(
  sheet: ISheet,
  obj: ISheetObject<$IntentionalAny>,
  propPath: string[],
  position: number,
): KeyframeTarget | undefined {
  const pointer = leafPointer(obj, propPath)
  const trackId = getTrackIdForPath(pointer, propPath)
  if (!trackId) return undefined
  const keyframe = sheet.sequence
    .getKeyframes(pointer as Pointer<{}>)
    .find((kf) => kf.position === position)
  return keyframe ? {trackId, keyframeId: keyframe.id} : undefined
}

/**
 * 写关键帧:先把播放头定位到 position(吸附由命令层按 snap 完成;
 * 事务内 set 的轨道感知写帧依赖播放头位置,core 会先对 position 做
 * 一次网格吸附),再分两档写值:
 *
 *   - 已建轨:单个可撤销事务 set(pointer, value);
 *   - 首次建轨:先以 undoable:false 的事务 setPrimitivePropAsSequenced
 *     建轨(轨道落进已提交 state),再以第二个可撤销事务 set 写首帧——
 *     事务内 set 的轨道检测只读已提交 track map,看不到同事务新建的
 *     轨道(trackId 随机生成,同 poseTrack.writePoseKeyframe 注释的
 *     已知限制),所以首帧必须等轨道提交后才能落成关键帧;建轨事务
 *     不入撤销栈,整个 keyframes.set 对撤销历史只呈现一步。
 */
export function setKeyframe(
  sheet: ISheet,
  obj: ISheetObject<$IntentionalAny>,
  propPath: string[],
  args: {position: number; value: unknown; sequenced: boolean},
): void {
  const studio = requireStudio()
  const pointer = leafPointer(obj, propPath)
  sheet.sequence.position = args.position
  if (!args.sequenced) {
    // 建轨:undoable:false,提交生效但不占撤销栈(同 scrub.commit(false))
    studio.transaction(({stateEditors}) => {
      const {root, path} = getPointerParts(pointer as Pointer<$IntentionalAny>)
      stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsSequenced(
        {
          ...(root as {address: SheetObjectAddress}).address,
          pathToProp: path,
        },
      )
    }, false)
  }
  studio.transaction(({set}) => {
    set(pointer, args.value as $IntentionalAny)
  })
}

/**
 * 移动关键帧:transformKeyframes 适配(参数形状同 AggregateKeyframeConnector
 * 拖拽),translate 为 from/to 差值,scale 恒 1、origin 恒 0;目标位置由
 * snappingFunction(closestGridPosition)落网格。源帧由命令层经
 * findKeyframeAt 先行校验。
 */
export function moveKeyframe(
  sheet: ISheet,
  obj: ISheetObject<$IntentionalAny>,
  target: KeyframeTarget,
  args: {from: number; to: number},
): void {
  const studio = requireStudio()
  studio.transaction(({stateEditors}) => {
    stateEditors.coreByProject.historic.sheetsById.sequence.transformKeyframes({
      ...obj.address,
      // id 跨适配层边界按不透明字符串传递,此处回到 core 的名义类型
      trackId: target.trackId as SequenceTrackId,
      keyframeIds: [target.keyframeId as KeyframeId],
      translate: args.to - args.from,
      scale: 1,
      origin: 0,
      snappingFunction: sheet.sequence.closestGridPosition,
    })
  })
}

/**
 * 删除指定位置的关键帧:播放头定位到 position 后 unset(pointer)——
 * core 的 unset 在 positionSnappedToGrid 处落刀;只删帧,绝不
 * unsequenceProp(轨道保留)。源帧由命令层经 findKeyframeAt 先行校验。
 */
export function deleteKeyframe(
  sheet: ISheet,
  obj: ISheetObject<$IntentionalAny>,
  propPath: string[],
  args: {position: number},
): void {
  const studio = requireStudio()
  const pointer = leafPointer(obj, propPath)
  sheet.sequence.position = args.position
  studio.transaction(({unset}) => {
    unset(pointer)
  })
}
