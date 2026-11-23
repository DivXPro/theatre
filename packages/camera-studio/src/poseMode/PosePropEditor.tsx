/**
 * 姿势属性编辑器(2026-10-01 属性面板姿势行 + 框体注册制):经 core 的
 * editor 配置项 + studio 自定义编辑器注册表,替换 pose 属性在详情面板里
 * 的值区域。
 *
 * 行内显示 = poseDisplayText 三态:T 姿势(空值/绑定)/ 预设名称(库)/
 * 自定义姿势(双击模型进姿势模式摆的,或选预设后又改过)。点值区域开
 * 左侧停靠的姿势选择框(不再是 select 式弹框):T 姿势 + 同骨架族库
 * 预设(异族置灰)——框体就是纯姿势列表,自定义不设选项,只能编辑产生。
 *
 * 框体注册制:pickerRegistry 的 'pose' 槽位注册了宿主组件就用宿主的
 * (props = 组装好的 options/current + onPick/onClose 回调),没注册用内置
 * PosePickerFrame。库管开/关与数据,宿主组件只画 UI、调回调完成选择。
 *
 * 写入走 editingTools.permanentlySetValue(theatre 原生通道):有轨道写帧、
 * 无轨道写静态,撤销/打帧与内置属性完全一致。
 *
 * 数据自给自足(面板与 playground 是两棵 React 树,不依赖闭包注入):
 * t 来自 studio 树的 i18n provider;库条目来自模块级库单例的订阅;骨架
 * 族经 obj → placement → 模型库条目异步解析,解析不出则不过滤全可点。
 *
 * 框体经 createPortal 挂到 document.body:属性面板在 shadow DOM 里,停靠
 * 框要盖全画布必须脱离 shadow 根(React context 穿 portal 保留,i18n 照常)。
 */
import React, {useContext, useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import styled from 'styled-components'
import {val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {usePrism} from '@dreamerbird/react'
import {useI18n} from '@dreamerbird/studio/i18n'
import {PopoverAutoCloseLock} from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import type {ISimplePropEditorReactProps} from '@dreamerbird/studio/propEditors/simpleEditors/ISimplePropEditorReactProps'
import type {ISheetObject} from '@dreamerbird/core'
import {getLibrary, useLibraryEntries} from '../assetLibrary/library'
import {useModelThumbUrl} from '../assetLibrary/useModelThumbUrl'
import type {PoseEntry} from '../assetLibrary/types'
import {
  getPlacementEntryForObject,
  getPlacementInstanceForObject,
} from '../PlacementManager'
import {
  evaluateStrips,
  hasSkeletalStripLayer,
  parseAnimationTracks,
} from '../animationStrips/model'
import {buildPoseOptions} from './poseOptions'
import {poseDisplayText} from './poseDisplayText'
import {poseEntryName} from '../poseNames'
import {serializeLibPose} from './poseValue'
import {isHandPoseEntry} from '../gestureProps'
import {getRegisteredPicker} from '../pickerRegistry'
import {PosePickerFrame} from './PosePickerFrame'
import {getUiConfig} from '../uiConfig'
import {resolveControlSpec} from './controlSpec'
import {getScenePoseCoverage} from './poseFrame'
import {
  enterPoseSession,
  requestPoseCancel,
  requestPoseSave,
  usePoseSession,
} from './poseSession'
import {
  getPoseKeyframePositions,
  resolveDefaultPose,
  writeDefaultPose,
} from './poseTrack'

type EditorProps = ISimplePropEditorReactProps<PropTypeConfig_AllSimples>

// 注册表组件按 AllSimples 声明(注册表对任意 simple 类型开放);
// pose 属性实为 string,值在使用处收窄
const PosePropEditor: React.FC<EditorProps> = ({editingTools, value, obj}) => {
  const {t} = useI18n()
  const poseEntries = useLibraryEntries('pose') as PoseEntry[]
  // 内置姿势由 StaticCatalogSource 目录提供(2026-10-10 去播种),无需触发
  const [pickerOpen, setPickerOpen] = useState(false)
  // 值区域 hover 态:对齐 BasicStringInput(静态透明无边框,hover 出底出边)
  const [valueHovered, setValueHovered] = useState(false)
  // 停靠框打开期间持父弹框锁:本编辑器也会渲染在时间轴帧弹框里,帧弹框
  // 有「挪远/点外部自动关」;停靠框 portal 到 body 不在其 DOM 内,不持锁
  // 的话鼠标一移向停靠框帧弹框就先关,本组件连同停靠框一起被卸载——
  // 颜色选择器的二级弹框赖同一机制存活。属性面板场景拿到默认空锁,零影响
  const parentPopoverLock = useContext(PopoverAutoCloseLock)
  useEffect(() => {
    if (!pickerOpen) return
    const held = parentPopoverLock.takeFocus()
    return () => held.releaseFocus()
  }, [pickerOpen, parentPopoverLock])
  // 编辑器所属对象的骨架族(obj → placement → 模型库条目),用于过滤异族预设;
  // 条目本体也留一份——「T 姿势」项的缩略图就用模型自己的图(模型图就是
  // 按绑定/T 姿势渲染的,语义正好)
  const [rig, setRig] = useState<string | undefined>(undefined)
  const [modelEntry, setModelEntry] = useState<
    {id: string; thumbnailId?: string} | undefined
  >(undefined)
  useEffect(() => {
    let cancelled = false
    const entry = obj ? getPlacementEntryForObject(obj.publicApi) : undefined
    if (!entry?.libraryEntryId) {
      setRig(undefined)
      setModelEntry(undefined)
      return
    }
    void getLibrary()
      .getEntry(entry.libraryEntryId)
      .then((libEntry) => {
        if (cancelled) return
        setRig(libEntry?.rig)
        setModelEntry(
          libEntry && 'thumbnailId' in libEntry
            ? {id: libEntry.id, thumbnailId: libEntry.thumbnailId}
            : undefined,
        )
      })
    return () => {
      cancelled = true
    }
  }, [obj])

  const poseJson = (value as string) ?? ''
  // 姿势框回归纯身体姿势(2026-10-05):纯手势条目(全是手指骨)挪去
  // 左手势/右手势选择框;显示文本仍查全表(旧值引用了手势条目也显名)
  const bodyPoseEntries = useMemo(
    () => poseEntries.filter((e) => !isHandPoseEntry(e)),
    [poseEntries],
  )
  // 缩略图懒加载(条目带 thumbnailId 时给选择框选项配图)
  const {getThumbUrl} = useModelThumbUrl()
  // 显示名:种子条目查 i18n 词典(纯姿势名),用户自存姿势回退条目名原文
  const nameOf = (e: {id: string; name: string}) => poseEntryName(e, t)
  const {options, current} = buildPoseOptions({
    poseJson,
    libEntries: bodyPoseEntries,
    selectedRig: rig,
    thumbUrlOf: getThumbUrl,
    bindThumbUrl: modelEntry ? getThumbUrl(modelEntry) : undefined,
    nameOf,
    t,
  })

  // 选后不关框(2026-10-05 与用户对齐):框留着可连续换姿势看效果,
  // 高亮随值刷新;关闭走 ✕/Esc
  const handlePick = (key: string): void => {
    editingTools.permanentlySetValue(
      key === 'bind' ? '' : serializeLibPose(key.slice(4)),
    )
  }

  // 每次开框现读注册表:宿主注册/注销无需订阅,下一次开框即生效
  const Picker = getRegisteredPicker('pose') ?? PosePickerFrame

  return (
    <>
      <div
        data-testid="PosePropValue"
        title={poseDisplayText({poseJson, libEntries: poseEntries, nameOf, t})}
        onClick={() => setPickerOpen(true)}
        onMouseEnter={() => setValueHovered(true)}
        onMouseLeave={() => setValueHovered(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          // 高度对齐 BasicStringInput 的 calc(100% - 4px):不显式撑高,
          // hover 出底边时会比相邻原生输入框矮一截
          height: 'calc(100% - 4px)',
          display: 'flex',
          alignItems: 'center',
          padding: '1px 6px',
          borderRadius: 2,
          border: `1px solid ${valueHovered ? '#00000059' : 'transparent'}`,
          background: valueHovered ? '#10101042' : 'transparent',
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: 11,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none',
        }}
      >
        {poseDisplayText({poseJson, libEntries: poseEntries, nameOf, t})}
      </div>
      {pickerOpen &&
        createPortal(
          <Picker
            options={options}
            current={current}
            onPick={handlePick}
            onClose={() => setPickerOpen(false)}
          />,
          // 宿主可配 portal 容器(ui.portalContainer),缺省挂 document.body
          getUiConfig().portalContainer ?? document.body,
        )}
    </>
  )
}

export default PosePropEditor

const PoseRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  height: 100%;
`

const PoseStatus = styled.span`
  min-width: 0;
  color: var(--theatre-text-secondary, #b8b8b8);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const PoseRowButton = styled.button`
  flex: 0 0 auto;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  &:hover:not(:disabled),
  &:focus-visible {
    background: #ffffff14;
    border-color: #ffffff26;
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`

function usePoseEditorPlacement(object?: ISheetObject<any>) {
  const placement = object && getPlacementInstanceForObject(object)
  const instance = placement?.instance
  const supported = useMemo(
    () => !!instance && resolveControlSpec(instance) !== null,
    [instance],
  )
  return {key: placement?.entry.key, supported}
}

function isSkeletalAnimationAt(object: ISheetObject<any>, position: number) {
  const state = parseAnimationTracks(
    (val(object.props.animationTracks) as string) ?? '',
  )
  if (!hasSkeletalStripLayer(state)) return !!val(object.props.animation)
  if (state.kind !== 'tracks') return false
  const tracks = state.document.tracks.filter(
    (track) => track.kind !== 'object',
  )
  return evaluateStrips({...state.document, tracks}, position * 1000).length > 0
}

export function DefaultPosePropEditor(props: EditorProps): React.ReactElement {
  const {t} = useI18n()
  const object = props.obj?.publicApi
  const placement = usePoseEditorPlacement(object)
  const session = usePoseSession()
  const editing = session?.target === 'static' && session.key === placement.key
  const value = usePrism(
    () => (object ? resolveDefaultPose(object) : props.value),
    [object, props.value],
  )
  const driven = usePrism(() => {
    if (!object || !editing) return false
    const position = val(object.sheet.sequence.pointer.position)
    return (
      getPoseKeyframePositions(object).length > 0 ||
      isSkeletalAnimationAt(object, position)
    )
  }, [object, editing])
  if (editing) {
    return (
      <PoseRow>
        <PoseRowButton type="button" onClick={requestPoseSave}>
          {t('pg.pose.saveDefault')}
        </PoseRowButton>
        <PoseRowButton type="button" onClick={requestPoseCancel}>
          {t('pg.pose.cancelEdit')}
        </PoseRowButton>
        {driven && (
          <PoseStatus role="status" title={t('pg.pose.animationDriven')}>
            {t('pg.pose.animationDriven')}
          </PoseStatus>
        )}
      </PoseRow>
    )
  }
  return (
    <PoseRow>
      <PosePropEditor
        {...props}
        value={value}
        editingTools={{
          ...props.editingTools,
          permanentlySetValue: (next) => {
            if (object && typeof next === 'string')
              writeDefaultPose(object, next)
          },
        }}
      />
      <PoseRowButton
        type="button"
        disabled={!placement.supported}
        onClick={() => {
          if (placement.key) enterPoseSession(placement.key, 'static')
        }}
      >
        {t('pg.pose.editDefault')}
      </PoseRowButton>
    </PoseRow>
  )
}

const coverageLabels = {
  none: 'pg.pose.firstSceneKey',
  key: 'pg.pose.sceneKey',
  between: 'pg.pose.sceneBetween',
  'hold-before': 'pg.pose.sceneHoldBefore',
  'hold-after': 'pg.pose.sceneHoldAfter',
} as const

export function ScenePosePropEditor(
  props: EditorProps & {keyframePosition?: number},
): React.ReactElement {
  if (!('type' in props.editingTools) && props.keyframePosition === undefined) {
    return <PosePropEditor {...props} />
  }
  return <ScenePoseRow {...props} />
}

function ScenePoseRow({
  obj,
  keyframePosition,
}: EditorProps & {keyframePosition?: number}): React.ReactElement {
  const {t} = useI18n()
  const object = obj?.publicApi
  const placement = usePoseEditorPlacement(object)
  const session = usePoseSession()
  const {coverage, label} = usePrism(() => {
    if (!object) return {coverage: 'none' as const, label: ''}
    const sequence = object.sheet.sequence
    const position =
      keyframePosition ??
      sequence.closestGridPosition(val(sequence.pointer.position))
    return {
      coverage: getScenePoseCoverage(
        getPoseKeyframePositions(object),
        position,
      ),
      label: privateAPI(sequence).positionFormatter.formatForPlayhead(position),
    }
  }, [object, keyframePosition])
  const editing =
    !!placement.key &&
    session?.key === placement.key &&
    (session.target ?? 'scene') === 'scene'
  const isKey = coverage === 'key'
  const action = t(isKey ? 'pg.pose.editFrame' : 'pg.pose.addKeyframe')
  const status = t(coverageLabels[coverage])
  const title =
    coverage === 'none'
      ? status
      : `${status} · ${t('pg.pose.sceneOverridesAnimation')}`
  return (
    <PoseRow>
      {editing ? (
        <>
          <PoseRowButton type="button" onClick={requestPoseSave}>
            {t('pg.pose.saveScene')}
          </PoseRowButton>
          <PoseRowButton type="button" onClick={requestPoseCancel}>
            {t('pg.pose.cancelEdit')}
          </PoseRowButton>
        </>
      ) : (
        <PoseRowButton
          type="button"
          data-testid="ScenePoseDiamond"
          disabled={!placement.supported}
          aria-label={action}
          title={action}
          onClick={() => {
            if (placement.key)
              enterPoseSession(placement.key, 'scene', keyframePosition)
          }}
        >
          {isKey ? '◆' : '◇'}
        </PoseRowButton>
      )}
      <PoseStatus data-coverage={coverage} title={title} aria-label={title}>
        {label && `${label} · `}
        {status}
      </PoseStatus>
    </PoseRow>
  )
}
