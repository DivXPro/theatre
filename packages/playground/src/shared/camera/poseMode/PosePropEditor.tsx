/**
 * 姿势属性编辑器(2026-10-01 属性面板姿势行):经 core 的 editor 配置项 +
 * studio 自定义编辑器注册表,替换 pose 属性在详情面板里的值区域。
 *
 * 行内显示 = poseDisplayText 三态:T 姿势(空值/绑定)/ 预设名称(库)/
 * 自定义姿势(双击模型进姿势模式摆的,或选预设后又改过)。点值区域弹
 * 姿势列表(与颜色属性点色块同一弹框机制):T 姿势 + 同骨架族库预设
 * (异族置灰)——弹框就是纯姿势列表,自定义不设选项,只能编辑产生。
 *
 * 写入走 editingTools.permanentlySetValue(theatre 原生通道):有轨道写帧、
 * 无轨道写静态,撤销/打帧与内置属性完全一致。
 *
 * 数据自给自足(面板与 playground 是两棵 React 树,不依赖闭包注入):
 * t 来自 studio 树的 i18n provider;库条目来自模块级库单例的订阅;骨架
 * 族经 obj → placement → 模型库条目异步解析,解析不出则不过滤全可点。
 * 样式全部 inline:styled-components 的样式表不进 shadow DOM。
 */
import React, {useEffect, useRef, useState} from 'react'
import usePopover from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import {useI18n} from '@dreamerbird/studio/i18n'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import type {ISimplePropEditorReactProps} from '@dreamerbird/studio/propEditors/simpleEditors/ISimplePropEditorReactProps'
import type {ISheetObject} from '@dreamerbird/core'
import {getLibrary, useLibraryEntries} from '../assetLibrary/library'
import type {PoseEntry} from '../assetLibrary/types'
import {getPlacementEntryForObject} from '../PlacementManager'
import {buildPoseOptions} from './poseOptions'
import {poseDisplayText} from './poseDisplayText'
import {serializeLibPose} from './poseValue'

// 注册表组件按 AllSimples 声明(注册表对任意 simple 类型开放);
// pose 属性实为 string,值在使用处收窄
const PosePropEditor: React.FC<
  ISimplePropEditorReactProps<PropTypeConfig_AllSimples>
> = ({editingTools, value, obj}) => {
  const {t} = useI18n()
  const poseEntries = useLibraryEntries('pose') as PoseEntry[]
  // 编辑器所属对象的骨架族(obj → placement → 模型库条目),用于过滤异族预设
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
      .backend.getEntry(entry.libraryEntryId)
      .then((libEntry) => {
        if (!cancelled) setRig(libEntry?.rig)
      })
    return () => {
      cancelled = true
    }
  }, [obj])

  const poseJson = (value as string) ?? ''
  const {options, current} = buildPoseOptions({
    poseJson,
    libEntries: poseEntries,
    selectedRig: rig,
    t,
  })

  const boxRef = useRef<HTMLDivElement>(null!)
  const popover = usePopover({debugName: 'PosePropEditor'}, () => (
    <div
      data-testid="PosePropPopover"
      style={{
        minWidth: 160,
        maxWidth: 240,
        maxHeight: 260,
        overflowY: 'auto',
        backgroundColor: '#24272b',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
        padding: '4px 0',
        fontSize: 11,
        color: '#eaeaea',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          padding: '4px 10px 6px',
          color: '#919191',
          fontSize: 10,
          fontWeight: 500,
        }}
      >
        {t('pg.pose.selectorTitle')}
      </div>
      {options.map((opt) => {
        const isCurrent = opt.key === current
        return (
          <div
            key={opt.key}
            data-pose-option={opt.key}
            title={opt.disabled ? opt.hint?.trim() : undefined}
            onClick={(e) => {
              e.stopPropagation()
              if (opt.disabled) return
              editingTools.permanentlySetValue(
                opt.key === 'bind' ? '' : serializeLibPose(opt.key.slice(4)),
              )
              popover.close('option picked')
            }}
            style={{
              padding: '5px 10px',
              cursor: opt.disabled ? 'default' : 'pointer',
              opacity: opt.disabled ? 0.4 : 1,
              backgroundColor: isCurrent
                ? 'rgba(125, 193, 200, 0.18)'
                : 'transparent',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onMouseEnter={(e) => {
              if (!opt.disabled && !isCurrent)
                e.currentTarget.style.backgroundColor =
                  'rgba(255, 255, 255, 0.06)'
            }}
            onMouseLeave={(e) => {
              if (!isCurrent)
                e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {opt.label}
            </span>
            {opt.hint && (
              <span style={{color: '#919191', flexShrink: 0}}>
                {opt.hint.trim()}
              </span>
            )}
          </div>
        )
      })}
    </div>
  ))

  return (
    <>
      <div
        ref={boxRef}
        data-testid="PosePropValue"
        title={poseDisplayText({poseJson, libEntries: poseEntries, t})}
        onClick={(e) => popover.toggle(e, boxRef.current)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '3px 6px',
          borderRadius: 2,
          border: '1px solid var(--theatre-panel-border, #1f1f1f)',
          background: 'rgba(0, 0, 0, 0.25)',
          color: 'var(--theatre-text-primary, #ffffff)',
          fontSize: 11,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none',
        }}
      >
        {poseDisplayText({poseJson, libEntries: poseEntries, t})}
      </div>
      {popover.node}
    </>
  )
}

export default PosePropEditor
