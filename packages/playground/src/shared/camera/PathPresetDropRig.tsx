/**
 * 路径预设拖拽的 Canvas 内容:落点标记(小球)跟随指针,松开 = 在该处
 * 生成预设路径,画布外松开/Esc/右键 = 取消。
 *
 * 落点语义(Blender G 抓取的对应物):
 * - 默认走视平面——指针射线与「过锚点、垂直于视线的平面」求交,指针上移
 *   世界里就升高,高度自由;锚点取拖动开始时的落点深度、基准高度取活动
 *   相机当前 Y(起手位置和旧版手感一致,拖离起手点即进入自由调节)
 * - 命中已放置的模型时贴它的表面:水平对到模型中心,高度用命中点真实
 *   高度(面吸附的对应物)
 * - 轴向约束(同 Blender):拖动中按 Z = 只沿竖直方向调(锁定 x/z),
 *   Shift+Z = 锁在水平面内(锁定 y),再按一次同样的组合解除;约束以
 *   按下那一刻的点位为基准,生效期间画轴线提示
 * - 标记始终显示在将要生成的精确点位(所见即所得)
 */
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Raycaster,
  Vector3,
} from 'three'
import type {Mesh, Object3D} from 'three'
import {
  computeDropPoint,
  computeHorizontalConstraintPoint,
  computeVerticalConstraintPoint,
  computeViewPlanePoint,
} from './dropPoint'
import {getPlacedModelRoots, getPlacementSurfaces} from './PlacementManager'

type AxisConstraint = 'vertical' | 'horizontal'

/** 约束轴线:竖直 = 一根竖线;水平 = 当前高度上的十字线。段很长,铺满视野 */
const GUIDE_HALF = 500

function makeGuide(): LineSegments {
  const geometry = new BufferGeometry()
  // 最多两段(水平十字),竖直只用第一段
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(12), 3),
  )
  const line = new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: 0x66ccff,
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  )
  line.frustumCulled = false
  line.renderOrder = 19
  line.visible = false
  return line
}

function updateGuide(
  guide: LineSegments,
  mode: AxisConstraint | null,
  p: Vector3,
): void {
  if (!mode) {
    guide.visible = false
    return
  }
  const attr = guide.geometry.getAttribute('position') as BufferAttribute
  if (mode === 'vertical') {
    attr.setXYZ(0, p.x, p.y - GUIDE_HALF, p.z)
    attr.setXYZ(1, p.x, p.y + GUIDE_HALF, p.z)
    guide.geometry.setDrawRange(0, 2)
  } else {
    attr.setXYZ(0, p.x - GUIDE_HALF, p.y, p.z)
    attr.setXYZ(1, p.x + GUIDE_HALF, p.y, p.z)
    attr.setXYZ(2, p.x, p.y, p.z - GUIDE_HALF)
    attr.setXYZ(3, p.x, p.y, p.z + GUIDE_HALF)
    guide.geometry.setDrawRange(0, 4)
  }
  attr.needsUpdate = true
  guide.visible = true
}

export function PathPresetDropRig({
  onConfirm,
  onCancel,
  heightY,
}: {
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  /** 视平面锚点的基准高度(活动相机当前 Y):起手落点保持旧版手感 */
  heightY: number
}) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const markerRef = useRef<Mesh>(null!)
  const raycaster = useMemo(() => new Raycaster(), [])
  const guide = useMemo(makeGuide, [])
  // 视平面锚点:拖动开始(第一次进入画布)时定死,之后整次拖动不变
  const anchorRef = useRef<Vector3 | null>(null)
  // 当前生效点位:标记显示和松手确认共用,保证「看到的=生成的」
  const currentRef = useRef(new Vector3(0, heightY, 0))
  // 轴向约束:ref 供帧回调/事件闭包读,state 只为让轴线随约束显隐重渲染
  const constraintRef = useRef<AxisConstraint | null>(null)
  const [, setConstraint] = useState<AxisConstraint | null>(null)
  // 约束基准:按下约束键那一刻的点位(Blender 以物体当前位置为轴心)
  const constraintBaseRef = useRef(new Vector3())

  // pointermove 一秒上百次:只记坐标并申请一帧,落点计算在帧回调里做一次
  const pendingMoveRef = useRef<{x: number; y: number} | null>(null)
  // 最近一次指针位置:约束键按下时按新约束就地重解
  const lastPointerRef = useRef<{x: number; y: number} | null>(null)
  const hitOut = useMemo(() => ({surfaceRoot: null as Object3D | null}), [])

  /** 一次完整的落点求解:轴向约束优先,其次模型表面吸附,否则视平面;
   *  各类求解失效时都保持上一帧点位 */
  const solve = (clientX: number, clientY: number): Vector3 => {
    const rect = gl.domElement.getBoundingClientRect()
    const mode = constraintRef.current
    if (mode === 'vertical') {
      const v = computeVerticalConstraintPoint(
        raycaster,
        camera,
        rect,
        clientX,
        clientY,
        constraintBaseRef.current,
      )
      if (v) currentRef.current.copy(v)
      return currentRef.current
    }
    if (mode === 'horizontal') {
      const v = computeHorizontalConstraintPoint(
        raycaster,
        camera,
        rect,
        clientX,
        clientY,
        constraintBaseRef.current,
      )
      if (v) currentRef.current.copy(v)
      return currentRef.current
    }
    const p = computeDropPoint(
      raycaster,
      camera,
      getPlacementSurfaces(),
      rect,
      clientX,
      clientY,
      hitOut,
    )
    if (!anchorRef.current) {
      anchorRef.current = new Vector3(p.x, heightY, p.z)
    }
    const root = hitOut.surfaceRoot
    if (root && getPlacedModelRoots().has(root)) {
      // 命中已放置模型:路径中心对到模型中心,高度贴命中表面
      const w = new Vector3()
      root.getWorldPosition(w)
      currentRef.current.set(w.x, p.y, w.z)
    } else {
      const v = computeViewPlanePoint(
        raycaster,
        camera,
        rect,
        clientX,
        clientY,
        anchorRef.current,
      )
      if (v) currentRef.current.copy(v)
    }
    return currentRef.current
  }

  useFrame(() => {
    const pending = pendingMoveRef.current
    if (!pending) return
    pendingMoveRef.current = null
    const p = solve(pending.x, pending.y)
    if (markerRef.current) {
      markerRef.current.visible = true
      markerRef.current.position.copy(p)
    }
    updateGuide(guide, constraintRef.current, p)
  })

  useEffect(() => {
    const el = gl.domElement
    const onMove = (ev: PointerEvent) => {
      lastPointerRef.current = {x: ev.clientX, y: ev.clientY}
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
      const p = solve(ev.clientX, ev.clientY)
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      onConfirm({x: p.x, y: p.y, z: p.z})
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        onCancel()
        return
      }
      // Blender 式轴向约束:Z = 只调高度,Shift+Z = 只在水平面;
      // 再按一次同样的组合解除。按住重复的 keydown 不重复翻转
      if (ev.key.toLowerCase() !== 'z' || ev.repeat) return
      const want: AxisConstraint = ev.shiftKey ? 'horizontal' : 'vertical'
      const next = constraintRef.current === want ? null : want
      constraintRef.current = next
      if (next) constraintBaseRef.current.copy(currentRef.current)
      setConstraint(next)
      // 就地按新约束重解:轴线/标记立刻反映,不用等下一次指针移动
      if (lastPointerRef.current) {
        pendingMoveRef.current = lastPointerRef.current
        invalidate()
      }
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
    // solve 每帧用到的值都来自 ref/useThree,闭包稳定
  }, [gl, camera, raycaster, invalidate, onConfirm, onCancel])

  return (
    <>
      <mesh ref={markerRef} visible={false}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial
          color="#ffaa00"
          transparent
          opacity={0.8}
          depthTest={false}
        />
      </mesh>
      <primitive object={guide} />
    </>
  )
}
