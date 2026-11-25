// packages/camera-studio/src/poseMode/PoseModeBar.tsx
/**
 * 摆姿势浮动小条:挂在被摆模型头顶(Head 骨骼世界位置 + 等比偏移),
 * 跟着模型/相机走(drei Html 把 DOM 钉到 3D 位置,屏幕恒定大小)。
 *
 * 移动/旋转与 W/E 键共用 poseSession 的 manipulatorMode(单一状态源):
 * 按钮 setPoseManipulatorMode → 本组件订阅刷新高亮;PoseModeRig 同一
 * 订阅转发 threeIK——两条路径永远一致,不存在"按钮瞎"或"环不跟着切"。
 *
 * 退出手势(快捷键/双击空白)在 App 与 PoseModeRig。
 */
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Html} from '@react-three/drei'
import {useFrame} from '@react-three/fiber'
import {ArrowClockwise, ArrowsOutCardinal} from '@phosphor-icons/react'
import {
  ToolbarIconButton,
  ToolbarSwitchSelectContainer,
} from '@dreamerbird/studio/camera-studio'
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
  usePoseSelectionModes,
} from './poseSession'

/** 头骨上方偏移(乘骨架等比倍率):离头顶远一截,编辑头颈时不挡视线 */
const HEAD_OFFSET = 0.6

/** 每帧复用的临时向量(避免逐帧分配) */
const tmpVec = new Vector3()

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
        {/* 不再外包盒子:裸分段控件(与顶栏 W/G/R/S 组同款观感) */}
        <ToolbarSwitchSelectContainer>
          {MODES.map(({mode: m, icon: Icon, labelKey, hintKey}) => (
            <ToolbarIconButton
              key={m}
              className={
                mode === m
                  ? 'cs-tooltip-trigger selected'
                  : 'cs-tooltip-trigger'
              }
              disabled={!selModes[m]}
              onClick={() => setPoseManipulatorMode(m)}
            >
              <Icon size={16} />
              <span className="tip">
                {translate(labelKey)}
                <span className="hint">{translate(hintKey)}</span>
              </span>
            </ToolbarIconButton>
          ))}
        </ToolbarSwitchSelectContainer>
      </Html>
    </group>
  )
}
