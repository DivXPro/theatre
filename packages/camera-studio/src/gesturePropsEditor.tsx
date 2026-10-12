// packages/camera-studio/src/gesturePropsEditor.tsx
/**
 * 手势属性编辑器(2026-10-05,左手势/右手势):姿势属性编辑器的「纯选择」版——
 * 值区域显示 无手势/手势名,点开左侧停靠选择框(PosePickerFrame 复用,
 * 标题按侧),选项 = 无手势 + 本侧(或双手)手势条目,异族置灰。
 * 没有自定义入口:不写 custom 快照、不挂姿势模式;打帧/撤销走 theatre
 * 原生通道(permanentlySetValue 有轨道写帧、无轨道写静态,与姿势一致)。
 *
 * 数据自给自足(同 PosePropEditor 的跨树约束):t 来自 studio 树 i18n
 * provider;库条目来自模块级库单例订阅;骨架族经 obj → placement →
 * 模型库条目异步解析,解析不出则不过滤全可点。
 *
 * 注册:App 里按侧注册两个 editor key(gestureL/gestureR),组件本体带
 * side prop,两个薄封装导出给注册表(签名对齐 ISimplePropEditorReactProps)。
 */
import React, {useContext, useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {useI18n} from '@dreamerbird/studio/i18n'
import {PopoverAutoCloseLock} from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import type {ISimplePropEditorReactProps} from '@dreamerbird/studio/propEditors/simpleEditors/ISimplePropEditorReactProps'
import type {ISheetObject} from '@dreamerbird/core'
import {getLibrary, useLibraryEntries} from './assetLibrary/library'
import {useModelThumbUrl} from './assetLibrary/useModelThumbUrl'
import type {PoseEntry} from './assetLibrary/types'
import {getPlacementEntryForObject} from './PlacementManager'
import {buildGestureOptions, gestureDisplayText} from './gestureProps'
import type {GestureSide} from './gestureProps'
import {poseEntryName} from './poseNames'
import {serializeLibPose} from './poseMode/poseValue'
import {PosePickerFrame} from './poseMode/PosePickerFrame'
import {getUiConfig} from './uiConfig'

type EditorProps = ISimplePropEditorReactProps<PropTypeConfig_AllSimples>

export function GesturePropEditor({
  editingTools,
  value,
  obj,
  side,
}: EditorProps & {side: GestureSide}): React.ReactElement {
  const {t} = useI18n()
  const poseEntries = useLibraryEntries('pose') as PoseEntry[]
  // 内置手势由 StaticCatalogSource 目录提供(2026-10-10 去播种),无需触发
  const [pickerOpen, setPickerOpen] = useState(false)
  const [valueHovered, setValueHovered] = useState(false)
  // 停靠框打开期间持父弹框锁(时间轴帧弹框嵌套场景,同 PosePropEditor)
  const parentPopoverLock = useContext(PopoverAutoCloseLock)
  useEffect(() => {
    if (!pickerOpen) return
    const held = parentPopoverLock.takeFocus()
    return () => held.releaseFocus()
  }, [pickerOpen, parentPopoverLock])
  // 编辑器所属对象的骨架族(obj → placement → 模型库条目),过滤异族手势
  const [rig, setRig] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const entry = obj
      ? getPlacementEntryForObject(obj as unknown as ISheetObject)
      : undefined
    if (!entry?.libraryEntryId) {
      setRig(undefined)
      return
    }
    void getLibrary()
      .getEntry(entry.libraryEntryId)
      .then((libEntry) => {
        if (!cancelled) setRig(libEntry?.rig)
      })
    return () => {
      cancelled = true
    }
  }, [obj])

  const gestureJson = (value as string) ?? ''
  // 缩略图懒加载(QBX 预览图):命中缓存直接给 URL,未命中触发加载后重渲
  const {getThumbUrl} = useModelThumbUrl()
  // 「无手势」项配图(2026-10-05):用本侧「基础·放松」条目的预览图——
  // 放松手就是无叠加手势的样子。种子条目 id 稳定(seed-pose-<key>)
  const baseEntry = poseEntries.find(
    (e) =>
      e.id ===
      `seed-pose-qbx-hands-01-base-base-${side === 'left' ? 'l' : 'r'}`,
  )
  const noneThumbUrl = baseEntry ? getThumbUrl(baseEntry) : undefined
  // 显示名:种子条目查 i18n 词典(纯姿势名),用户自存姿势回退条目名原文
  const nameOf = (e: {id: string; name: string}) => poseEntryName(e, t)
  const {options, current} = buildGestureOptions({
    gestureJson,
    libEntries: poseEntries,
    side,
    selectedRig: rig,
    thumbUrlOf: getThumbUrl,
    noneThumbUrl,
    nameOf,
    t,
  })
  const display = gestureDisplayText({
    gestureJson,
    libEntries: poseEntries,
    nameOf,
    t,
  })

  // 选后不关框(2026-10-05 与用户对齐,同姿势框):可连续换手势看效果
  const handlePick = (key: string): void => {
    editingTools.permanentlySetValue(
      key === 'none' ? '' : serializeLibPose(key.slice(4)),
    )
  }

  return (
    <>
      <div
        data-testid={
          side === 'left' ? 'GesturePropValueL' : 'GesturePropValueR'
        }
        title={display}
        onClick={() => setPickerOpen(true)}
        onMouseEnter={() => setValueHovered(true)}
        onMouseLeave={() => setValueHovered(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
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
        {display}
      </div>
      {pickerOpen &&
        createPortal(
          <PosePickerFrame
            options={options}
            current={current}
            title={t(
              side === 'left'
                ? 'pg.gesture.selectorTitleL'
                : 'pg.gesture.selectorTitleR',
            )}
            onPick={handlePick}
            onClose={() => setPickerOpen(false)}
          />,
          // 宿主可配 portal 容器(ui.portalContainer),缺省挂 document.body
          getUiConfig().portalContainer ?? document.body,
        )}
    </>
  )
}

/** 注册表薄封装:editor key gestureL/gestureR 各绑一侧 */
export const GesturePropEditorLeft: React.FC<EditorProps> = (props) => (
  <GesturePropEditor {...props} side="left" />
)
export const GesturePropEditorRight: React.FC<EditorProps> = (props) => (
  <GesturePropEditor {...props} side="right" />
)
