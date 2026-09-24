// packages/playground/src/shared/camera/poseMode/PoseModeRig.tsx
/**
 * 姿势模式运行时:SkeletonRig + threeIK 控制点的生命周期、每帧求解、退出提交。
 * 会话命中时由 PlacedModelCore 挂载;卸载(模型删除/会话切换)即 dispose 干净。
 *
 * 帧更新契约(threeIK README):基准姿势在进入时 captureBasePose 一次
 * (= 当前姿势,含 poseOverride/库姿势/绑定姿势;不接 mixer 时无需每帧采),
 * 之后每帧 rig.update + ctl.update;demand 帧循环下只在按下指针期间续帧。
 */
import {useEffect, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {getStudioSync, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {Raycaster, Vector2} from 'three'
import type {Group} from 'three'
import {SkeletonRig} from '@dreamerbird/threeik'
import {createSkeletonControls} from '@dreamerbird/threeik/controls'
import {capturePose} from '../assetLibrary/pose'
import {
  measureSkeletonScale,
  resolveControlSpec,
  findRootBone,
} from './controlSpec'
import {anyControlDragging} from './dragState'
import {stringifyPoseOverride} from './poseOverride'
import {
  clearPoseSession,
  clearPoseSessionIfCurrent,
  getPoseManipulatorMode,
  isPoseDirty,
  markPoseDirty,
  onPoseExitRequested,
  onPoseManipulatorModeChange,
  setPoseHitTester,
  setPoseManipulatorMode,
} from './poseSession'

export function PoseModeRig({
  instance,
  sheetObject,
  placementKey,
  sheet,
}: {
  instance: Group
  sheetObject: ISheetObject<any>
  placementKey: string
  sheet: ISheet
}): null {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  // drei makeDefault 的轨道控制器:拖控制球期间锁住,防视角跟转
  const orbitControls = useThree((s) => s.controls) as unknown as {
    enabled: boolean
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const rigRef = useRef<SkeletonRig | null>(null)
  const ctlRef = useRef<ReturnType<typeof createSkeletonControls> | null>(null)
  const pressingRef = useRef(false)
  const dirtyRef = useRef(false)
  const controlNamesRef = useRef<string[]>([])

  useEffect(() => {
    const rootBone = findRootBone(instance)
    const spec = resolveControlSpec(instance)
    if (!rootBone || !spec) {
      // 入口已拦(菜单置灰/双击静默),这里是防御:直接清会话不挂载
      clearPoseSession()
      return
    }
    const rig = new SkeletonRig(rootBone)
    rigRef.current = rig
    rig.on('warning', (payload) =>
      console.warn('[poseMode]', (payload as {message?: string})?.message),
    )
    // 基准 = 当前姿势:没被控制点覆盖的骨骼保持原样,不弹回绑定姿势
    rig.captureBasePose()
    controlNamesRef.current = spec.map((c) => c.name)
    dirtyRef.current = false
    const sizeScale = measureSkeletonScale(instance)
    // threeIK 默认尺寸按 ~1.7 单位人形标定;球/环/注视随骨架世界高度等比,才看得见点得中
    const ctl = createSkeletonControls({
      rig,
      scene,
      camera,
      dom: gl.domElement,
      controls: spec,
      defaults: {
        ballRadius: 0.0225 * sizeScale,
        rootRadius: 0.4 * sizeScale,
        ringRadius: 0.16 * sizeScale,
        lookAtRadius: 0.35 * sizeScale,
      },
      dragControl: {
        lock: () => {
          if (orbitControls) orbitControls.enabled = false
        },
        unlock: () => {
          if (orbitControls) orbitControls.enabled = true
        },
      },
    })
    ctlRef.current = ctl

    // threeIK 0.0.1 无内置热键:自监听 W/E 经 poseSession 共享状态切操纵器
    // 模式(浮动小条按钮同一入口,UI 高亮因此永远同步;直接调 ctl 会让小条瞎)。
    // Esc 未被监听,天然留给 App 退出会话。
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat) return
      const target = ev.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )
        return
      if (ev.code === 'KeyW') setPoseManipulatorMode('move')
      else if (ev.code === 'KeyE') setPoseManipulatorMode('rotate')
      else return
      invalidate() // demand 帧循环:无指针按下时补帧,环/箭头立刻可见
    }
    window.addEventListener('keydown', onKey)

    // 共享状态 → threeIK:小条按钮切换时转发;进会话用记住的偏好初始化
    ctl.setManipulatorMode(getPoseManipulatorMode())
    const offMode = onPoseManipulatorModeChange((m) => {
      ctl.setManipulatorMode(m)
      invalidate()
    })

    // 双击空白退出的命中测试:点在被摆模型或控制球上不算空白
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    setPoseHitTester(({clientX, clientY}) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
      raycaster.setFromCamera(ndc, camera)
      const balls = ctl.targets.map((t) => t.ball)
      return raycaster.intersectObjects([instance, ...balls], true).length > 0
    })

    // 退出提交:捕获实时骨骼 → 一步 theatre 历史写 poseOverride(可撤销)
    const offExit = onPoseExitRequested((key) => {
      if (key !== placementKey) return
      const studio = getStudioSync()
      // 脏检查:没拖过控制点就不提交(threeIK 首解有微小漂移,
      // 空进空出写回会产生幻影撤销步;语义对齐 modalGrab 的 moved)。
      // 双通道或:dirtyRef 由 isDragging 轮询记(帧间隙完整的拖动),
      // isPoseDirty 由 pointerdown 事件记(同帧间隙的按下-拖-松,轮询漏检)
      if (studio && (dirtyRef.current || isPoseDirty())) {
        const bones = capturePose(instance)
        const scrub = studio.scrub()
        scrub.capture(({set}) => {
          set(
            sheetObject.props.poseOverride as any,
            stringifyPoseOverride(bones),
          )
        })
        scrub.commit()
      }
      clearPoseSession()
    })

    invalidate() // 进姿势模式首帧:控制球立刻可见
    return () => {
      offExit()
      offMode()
      setPoseHitTester(null)
      window.removeEventListener('keydown', onKey)
      ctl.dispose()
      ctlRef.current = null
      rigRef.current = null
      // 会话外因素卸载(模型被删等):实例已毁,跳过提交只清会话态。
      // 按键清:A→B 直接切换时 session 已是 B,不能把它抹掉(切换坍塌)
      clearPoseSessionIfCurrent(placementKey)
      invalidate()
    }
  }, [
    instance,
    sheetObject,
    placementKey,
    scene,
    camera,
    gl,
    orbitControls,
    invalidate,
  ])

  // demand 帧循环:按下指针期间逐帧求解+续帧,松开即停
  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const down = (ev: PointerEvent) => {
      // 只有按中控制球才记脏:isDragging 轮询会漏同帧间隙的按下-拖-松,
      // 由这里兜底;空白/模型身上的按下(含双击空白退出的第一击)不记——
      // 否则转下视角、退出手势本身都会制造幻影提交
      const ctl = ctlRef.current
      if (ctl) {
        const rect = dom.getBoundingClientRect()
        ndc.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
        )
        raycaster.setFromCamera(ndc, camera)
        const balls = ctl.targets.map((t) => t.ball)
        if (raycaster.intersectObjects(balls, true).length > 0) markPoseDirty()
      }
      pressingRef.current = true
      invalidate()
    }
    const up = () => {
      pressingRef.current = false
      invalidate() // 松手补一帧:钳制回弹落定
    }
    dom.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      dom.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [gl, camera, invalidate])

  useFrame((_, delta) => {
    const rig = rigRef.current
    const ctl = ctlRef.current
    if (!rig || !ctl) return
    if (val(sheet.sequence.pointer.playing)) return // 播放时 mixer 写骨骼,不抢
    rig.update(delta)
    ctl.update()
    if (!dirtyRef.current && anyControlDragging(ctl, controlNamesRef.current)) {
      dirtyRef.current = true
    }
    if (pressingRef.current) invalidate()
  })

  return null
}
