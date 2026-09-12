/**
 * 路径预设拖拽的 Canvas 内容:落点标记(小球)跟随指针,松开 = 在该处
 * 生成预设路径,画布外松开/Esc/右键 = 取消。落点数学与模型放置共用
 * computeDropPoint(表面优先、地面兜底、朝天退前方 30)。
 * 路径生成在活动相机高度(heightY),标记也显示在这个高度——标记在哪,
 * 路径就在哪,不会标记贴地、路径在天上(落地即进编辑模式,点立即可见可改)。
 * 命中已放置物体时,路径中心对到物体中心(和点击放到场景中心一个语义);
 * 命中空地面/朝天时保持指针的精确落点。
 */
import React, {useEffect, useMemo, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {Raycaster, Vector3} from 'three'
import type {Mesh, Object3D} from 'three'
import {computeDropPoint} from './dropPoint'
import {getPlacedModelRoots, getPlacementSurfaces} from './PlacementManager'

/** 路径中心的水平位置:命中放置的模型 = 模型中心;背景/地面/朝天 = 指针精确落点 */
function pathCenterXZ(p: Vector3, out: {surfaceRoot: Object3D | null}) {
  const root = out.surfaceRoot
  if (!root || !getPlacedModelRoots().has(root)) return {x: p.x, z: p.z}
  const w = new Vector3()
  root.getWorldPosition(w)
  return {x: w.x, z: w.z}
}

export function PathPresetDropRig({
  onConfirm,
  onCancel,
  heightY,
}: {
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  /** 路径生成高度(活动相机当前 Y):标记显示在这个高度,与落点语义一致 */
  heightY: number
}) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const markerRef = useRef<Mesh>(null!)
  const raycaster = useMemo(() => new Raycaster(), [])

  // pointermove 一秒上百次:只记坐标并申请一帧,落点计算在帧回调里做一次
  const pendingMoveRef = useRef<{x: number; y: number} | null>(null)
  const hitOut = useMemo(() => ({surfaceRoot: null as Object3D | null}), [])
  useFrame(() => {
    const pending = pendingMoveRef.current
    if (!pending) return
    pendingMoveRef.current = null
    const p = computeDropPoint(
      raycaster,
      camera,
      getPlacementSurfaces(),
      gl.domElement.getBoundingClientRect(),
      pending.x,
      pending.y,
      hitOut,
    )
    if (markerRef.current) {
      const c = pathCenterXZ(p, hitOut)
      markerRef.current.visible = true
      markerRef.current.position.set(c.x, heightY, c.z)
    }
  })

  useEffect(() => {
    const el = gl.domElement
    const onMove = (ev: PointerEvent) => {
      pendingMoveRef.current = {x: ev.clientX, y: ev.clientY}
      invalidate()
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      // 同 PlacementRigCore:松手在面板 DOM 上(target 非画布)= 静默取消
      if (ev.target !== el) {
        onCancel()
        return
      }
      const rect = el.getBoundingClientRect()
      const p = computeDropPoint(
        raycaster,
        camera,
        getPlacementSurfaces(),
        rect,
        ev.clientX,
        ev.clientY,
        hitOut,
      )
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      const c = pathCenterXZ(p, hitOut)
      onConfirm({x: c.x, y: p.y, z: c.z})
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel()
    }
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault()
      onCancel()
    }
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [gl, camera, raycaster, invalidate, onConfirm, onCancel])

  return (
    <mesh ref={markerRef} visible={false}>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshBasicMaterial
        color="#ffaa00"
        transparent
        opacity={0.8}
        depthTest={false}
      />
    </mesh>
  )
}
