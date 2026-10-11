import {useThree} from '@react-three/fiber'
import {getStudioSync} from '@dreamerbird/core'
import type {IScrub} from '@dreamerbird/core'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Plane, Raycaster, Vector2, Vector3} from 'three'

/**
 * Blender 式模态抓取(G 键的对应物):开始后目标跟随鼠标在"过起点、
 * 正对相机"的平面里移动;X/Y/Z 锁轴(再按同键解锁);Esc 取消(整个
 * 拖拽废弃、弹回原位)。两种起手式:
 *
 * - 键盘起手(按 G):鼠标是抬起的,左键/回车确认,右键/Esc 取消
 * - 鼠标起手(按住手柄圆点直接拖):松左键确认,Esc 取消
 *
 * 写回走 scrub:移动中逐帧 capture(theatre 状态实时可见),确认一次
 * commit = 一步撤销;取消 discard 全部回滚。路径控制点/贝塞尔手柄
 * (CameraPath)和放置物(PlacementManager)共用这一套。
 */

export type ModalGrabStart = {
  /** 世界坐标起点(抓取的平面过这个点) */
  startPos: Vector3
  /** true = 鼠标已经按着(直接拖),松手确认;false = 键盘起手,点击确认 */
  dragging: boolean
  /** 移动中调用:把世界坐标新位置写进 scrub(逐帧 capture) */
  capture: (scrub: IScrub, worldPos: Vector3) => void
}

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

/** 全局同时最多一个抓取(路径/放置物两套调用方互斥,谁先谁得) */
let activeSession: {end: (commit: boolean) => void} | null = null

export function useModalGrab(): {
  /** 已开始抓取返回 true;已有抓取进行中/无 studio 返回 false */
  start: (opts: ModalGrabStart) => boolean
  /** 是否有抓取进行中(用来藏三轴箭头,避免两套拖动撞车) */
  active: boolean
} {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const [active, setActive] = useState(false)
  // 组件卸载时若抓取还活着,兜底取消(比如抓取中退出了编辑模式)
  const endRef = useRef<((commit: boolean) => void) | null>(null)
  useEffect(
    () => () => {
      endRef.current?.(false)
    },
    [],
  )

  const start = useCallback(
    (opts: ModalGrabStart): boolean => {
      if (activeSession) return false
      const studio = getStudioSync()
      if (!studio) return false

      const scrub = studio.scrub()
      // 过起点、法线朝相机的平面:鼠标射线与它的交点即目标位置
      const plane = new Plane()
      const normal = camera.getWorldDirection(new Vector3())
      plane.setFromNormalAndCoplanarPoint(normal, opts.startPos.clone())

      let axis: Vector3 | null = null
      let moved = false
      let finished = false
      const ndc = new Vector2()
      const raycaster = new Raycaster()
      const hit = new Vector3()
      const delta = new Vector3()

      const end = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onDown, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('contextmenu', onCtxMenu, true)
        activeSession = null
        endRef.current = null
        setActive(false)
        // 只在真的动过之后才提交:原地点击不产生空撤销步骤
        if (commit && moved) scrub.commit()
        else scrub.discard()
        invalidate()
      }

      const updateFromPointer = (ev: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect()
        ndc.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
        )
        raycaster.setFromCamera(ndc, camera)
        if (!raycaster.ray.intersectPlane(plane, hit)) return
        if (axis) {
          // 锁轴:只在轴方向上投影(Blender 的 G X/Y/Z)
          delta.copy(hit).sub(opts.startPos)
          hit.copy(opts.startPos).addScaledVector(axis, delta.dot(axis))
        }
        moved = true
        opts.capture(scrub, hit)
        invalidate()
      }

      const onMove = (ev: PointerEvent) => updateFromPointer(ev)
      // 键盘起手的确认/取消键;captured 阶段拦下,不让画布的点击/选中逻辑吃到
      const onDown = (ev: PointerEvent) => {
        if (opts.dragging) return
        if (ev.button === 0) {
          ev.stopPropagation()
          end(true)
        } else if (ev.button === 2) {
          ev.stopPropagation()
          ev.preventDefault()
          end(false)
        }
      }
      // 鼠标起手:松左键确认
      const onUp = (ev: PointerEvent) => {
        if (opts.dragging && ev.button === 0) end(true)
      }
      const onKey = (ev: KeyboardEvent) => {
        if (ev.code === 'Escape') {
          ev.stopPropagation()
          end(false)
          return
        }
        if (!opts.dragging && ev.code === 'Enter') {
          ev.stopPropagation()
          end(true)
          return
        }
        const next =
          ev.code === 'KeyX'
            ? X_AXIS
            : ev.code === 'KeyY'
              ? Y_AXIS
              : ev.code === 'KeyZ'
                ? Z_AXIS
                : null
        // 锁轴开关:按一下锁,再按同键解;键本身不产生移动
        if (next) axis = axis === next ? null : next
      }
      // 抓取期间屏蔽浏览器右键菜单(右键 = 取消,不是菜单)
      const onCtxMenu = (ev: Event) => ev.preventDefault()

      activeSession = {end}
      endRef.current = end
      setActive(true)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('contextmenu', onCtxMenu, true)
      return true
    },
    [camera, gl, invalidate],
  )

  return {start, active}
}
