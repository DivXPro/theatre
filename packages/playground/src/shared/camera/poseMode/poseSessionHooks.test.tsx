/*
 * @jest-environment jsdom
 */
/**
 * usePoseFrameMode 同渲染批竞态回归:
 * PoseModeBar 与 PoseModeRig 在同一渲染批挂载(PlacementManager L1414 条件内),
 * Rig 的挂载 effect 先跑——setPoseSessionFrame + emitChange 时 Bar 的订阅
 * effect 还没注册,通知被错过。hook 必须在订阅时回读当前值,
 * 而不是停在 useState 初值 null(浮条帧模式文案缺失)。
 */
import React from 'react'
import {act} from 'react'
import ReactDOM from 'react-dom/client'
import {
  enterPoseSession,
  setPoseSessionFrame,
  clearPoseSession,
  usePoseFrameMode,
} from './poseSession'
import type {PoseFrameMode} from './poseFrame'

/** 模拟 PoseModeRig:挂载 effect 里写帧信息(先挂载,effect 先跑) */
function Writer({frame}: {frame: PoseFrameMode}) {
  React.useEffect(() => {
    setPoseSessionFrame('M', frame)
  }, [frame])
  return null
}

/** 模拟 PoseModeBar:订阅帧模式(后挂载) */
function Reader({observed}: {observed: Array<PoseFrameMode | null>}) {
  const frame = usePoseFrameMode()
  observed.push(frame)
  return null
}

test('同渲染批内写入先于订阅:hook 收敛到帧信息而非停在 null', () => {
  const frame: PoseFrameMode = {mode: 'new', position: 2}
  // 对齐真实时序:双击事件先进会话,随后才渲染 Rig/Bar
  enterPoseSession('M')
  const observed: Array<PoseFrameMode | null> = []
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = ReactDOM.createRoot(el)
  try {
    act(() => {
      root.render(
        <>
          <Writer frame={frame} />
          <Reader observed={observed} />
        </>,
      )
    })
    expect(observed[observed.length - 1]).toEqual(frame)
  } finally {
    act(() => root.unmount())
    el.remove()
    clearPoseSession()
  }
})
