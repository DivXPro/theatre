// packages/playground/src/shared/camera/poseMode/PoseModeBar.tsx
/**
 * 摆姿势浮动小条:挂在被摆模型头顶(Head 骨骼世界位置 + 等比偏移),
 * 跟着模型/相机走(drei Html 把 DOM 钉到 3D 位置,屏幕恒定大小)。
 * 内容:「正在摆姿势 · [编辑关键帧|新建关键帧] · [移动|旋转] · Esc 完成」。
 * 帧模式文案来自 poseSession 的 usePoseFrameMode:进会话时 PoseModeRig
 * 判定(播放头贴网格后落在帧上=编辑该帧,否则=新建帧)并写入。
 *
 * 移动/旋转与 W/E 键共用 poseSession 的 manipulatorMode(单一状态源):
 * 按钮 setPoseManipulatorMode → 本组件订阅刷新高亮;PoseModeRig 同一
 * 订阅转发 threeIK——两条路径永远一致,不存在"按钮瞎"或"环不跟着切"。
 *
 * Esc 只是提示文字:退出手势(快捷键/双击空白)在 App 与 PoseModeRig。
 */
import React, {useEffect, useMemo, useRef, useState} from 'react'
import styled from 'styled-components'
import {Html} from '@react-three/drei'
import {useFrame} from '@react-three/fiber'
import {ArrowClockwise, ArrowsOutCardinal} from '@phosphor-icons/react'
import ToolbarIconButton from '@dreamerbird/studio/uiComponents/toolbar/ToolbarIconButton'
import ToolbarSwitchSelectContainer from '@dreamerbird/studio/uiComponents/toolbar/ToolbarSwitchSelectContainer'
import {onLanguageChange, translate} from '@dreamerbird/studio/i18n'
import {suggestBoneMap} from '@dreamerbird/threeik'
import type {Group, Object3D} from 'three'
import {Vector3} from 'three'
import {collectBoneNames} from '../assetLibrary/rig'
import {measureSkeletonScale} from './controlSpec'
import {
  getPoseManipulatorMode,
  onPoseManipulatorModeChange,
  setPoseManipulatorMode,
  usePoseFrameMode,
  usePoseSelectionModes,
} from './poseSession'

/** 头骨上方偏移(乘骨架等比倍率):头顶再留一截,不压模型 */
const HEAD_OFFSET = 0.35

/** 每帧复用的临时向量(避免逐帧分配) */
const tmpVec = new Vector3()

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--theatre-panel-bg-80, rgba(40, 43, 47, 0.8));
  backdrop-filter: blur(14px);
  border: 0.5px solid rgb(86 100 110 / 46%);
  box-shadow: rgb(0 0 0 / 25%) 0px 2px 4px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  /* 拖过小条文字区域不触发画布 orbit(按钮区域本就截获事件) */
  user-select: none;
`

const BarLabel = styled.span`
  color: var(--theatre-text-primary, #ffffff);
`

const BarFrame = styled.span`
  color: var(--theatre-text-secondary, #cccccc);
`

const BarEsc = styled.span`
  color: var(--theatre-text-secondary, #cccccc);
`

/** 原生 ToolbarIconButton + tooltip(样式照抄 TopToolbar 的 Btn,保持观感一致) */
const ModeBtn = styled(ToolbarIconButton)`
  /* tooltip:按钮 relative,气泡钉在正下方 */
  & > .tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    padding: 6px 8px;
    border-radius: 4px;
    box-shadow: rgb(0 0 0 / 25%) 0px 2px 4px;
    backdrop-filter: blur(8px) saturate(300%) contrast(65%) brightness(55%);
    background-color: rgb(45 46 66 / 50%);
    border: 0.5px solid rgb(86 100 110 / 46%);
    color: var(--theatre-text-primary, #ffffff);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.5;
    white-space: nowrap;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.15s ease 0.25s,
      visibility 0.15s ease 0.25s;
    .hint {
      display: block;
      color: var(--theatre-text-secondary, #cccccc);
    }
  }
  &:hover > .tip {
    opacity: 1;
    visibility: visible;
  }
`

const MODES = [
  {
    mode: 'move' as const,
    icon: ArrowsOutCardinal,
    labelKey: 'pg.gizmo.translate',
    hintKey: 'pg.posebar.move.hint',
  },
  {
    mode: 'rotate' as const,
    icon: ArrowClockwise,
    labelKey: 'pg.gizmo.rotate',
    hintKey: 'pg.posebar.rotate.hint',
  },
]

export function PoseModeBar({
  instance,
}: {
  instance: Group
}): React.JSX.Element | null {
  const anchorRef = useRef<Group>(null)

  // Head 是必映射骨(覆盖率不足根本进不了会话),查不到属防御分支:不挂小条
  const {headBone, sizeScale} = useMemo(() => {
    const {map} = suggestBoneMap(collectBoneNames(instance))
    const name = map.findModelBone('Head')
    const bone: Object3D | null = name
      ? instance.getObjectByName(name) ?? null
      : null
    return {headBone: bone, sizeScale: measureSkeletonScale(instance)}
  }, [instance])

  // 当前模式订阅共享状态:W/E 键与小条按钮同一入口,高亮永远同步
  const [mode, setMode] = useState(getPoseManipulatorMode())
  useEffect(() => onPoseManipulatorModeChange(setMode), [])

  // 选中目标的模式支持集:单模式点(纯旋转环/纯移动球)禁用不可用按钮
  const selModes = usePoseSelectionModes()

  // 帧模式(编辑关键帧/新建关键帧):PoseModeRig 进会话时判定写入
  const frameMode = usePoseFrameMode()

  // 语言热切换:Canvas 是 r3f 独立渲染根,context 不桥接,useT 拿不到
  // DOM 树的 I18nProvider;translate 是模块级函数、调用时读当前语言,
  // 再订阅语言变化触发重渲染即可
  const [, setLangTick] = useState(0)
  useEffect(() => onLanguageChange(() => setLangTick((n) => n + 1)), [])

  // 每帧把锚点组同步到头骨世界位置。渲染时机不用管:拖球/转视角都会
  // invalidate(demand 帧循环),静止时锚点不动、无需更新。
  // 锚点组挂在放置组(自带位移/缩放,如 Y_Bot 0.026)里,position 是父级
  // 本地坐标:必须先在世界空间取头骨位置+偏移,再转回父级本地空间——
  // 直接写世界坐标会被父级缩放压到模型脚下(实测踩过)
  useFrame(() => {
    const anchor = anchorRef.current
    if (!anchor || !headBone) return
    headBone.getWorldPosition(tmpVec)
    tmpVec.y += HEAD_OFFSET * sizeScale
    if (anchor.parent) anchor.parent.worldToLocal(tmpVec)
    anchor.position.copy(tmpVec)
  })

  if (!headBone) return null
  return (
    <group ref={anchorRef}>
      {/* zIndexRange 压在顶栏(10)量级:高于画布、低于 studio 菜单/面板;
          不做遮挡剔除——可读性优先,被模型挡住也比找不到强 */}
      <Html center zIndexRange={[15, 0]} wrapperClass="pose-bar-wrapper">
        <Bar>
          <BarLabel>{translate('pg.posebar.posing')}</BarLabel>
          {frameMode && (
            <BarFrame>
              {translate(
                frameMode.mode === 'edit'
                  ? 'pg.pose.editFrame'
                  : 'pg.pose.newFrame',
              )}
            </BarFrame>
          )}
          <ToolbarSwitchSelectContainer>
            {MODES.map(({mode: m, icon: Icon, labelKey, hintKey}) => (
              <ModeBtn
                key={m}
                className={mode === m ? 'selected' : ''}
                disabled={!selModes[m]}
                onClick={() => setPoseManipulatorMode(m)}
              >
                <Icon size={16} />
                <span className="tip">
                  {translate(labelKey)}
                  <span className="hint">{translate(hintKey)}</span>
                </span>
              </ModeBtn>
            ))}
          </ToolbarSwitchSelectContainer>
          <BarEsc>{translate('pg.posebar.esc')}</BarEsc>
        </Bar>
      </Html>
    </group>
  )
}
