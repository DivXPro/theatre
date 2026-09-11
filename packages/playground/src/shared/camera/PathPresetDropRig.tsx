/**
 * 路径预设拖拽的 Canvas 内容:落点标记(小球)跟随指针,松开 = 在该处
 * 生成预设路径,画布外松开/Esc/右键 = 取消。落点数学与模型放置共用
 * computeDropPoint(表面优先、地面兜底、朝天退前方 30)。
 * 路径生成在活动相机高度,标记只指示 XZ 落点,不预览形状(落地即进
 * 编辑模式,点立即可见可改)。
 */
import React, {useEffect, useMemo, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {Raycaster} from 'three'
import type {Mesh} from 'three'
import {computeDropPoint} from './dropPoint'
import {getPlacementSurfaces} from './PlacementManager'

export function PathPresetDropRig({
  onConfirm,
  onCancel,
}: {
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
}) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const markerRef = useRef<Mesh>(null!)
  const raycaster = useMemo(() => new Raycaster(), [])

  // pointermove 一秒上百次:只记坐标并申请一帧,落点计算在帧回调里做一次
  const pendingMoveRef = useRef<{x: number; y: number} | null>(null)
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
    )
    if (markerRef.current) {
      markerRef.current.visible = true
      markerRef.current.position.copy(p)
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
      )
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      onConfirm({x: p.x, y: p.y, z: p.z})
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
