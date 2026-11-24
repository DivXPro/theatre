// packages/camera-studio/src/poseMode/PoseModeRig.tsx
/**
 * 姿势模式运行时:IK 控制点的生命周期、每帧求解、退出提交。
 * 会话命中时由 PlacedModelCore 挂载;卸载(模型删除/会话切换)即 dispose 干净。
 */
import {useEffect, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {onChange, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {Quaternion, Raycaster, Vector2, Vector3} from 'three'
import type {Group} from 'three'
import {SkeletonRig} from '@dreamerbird/threeik'
import {createSkeletonControls} from '@dreamerbird/threeik/controls'
import type {
  LimbControlHandle,
  LimbControlSpec,
} from '@dreamerbird/threeik/controls'
import {
  deriveHumanoidFacing,
  measureSkeletonScale,
  resolveControlSpec,
  findRootBone,
} from './controlSpec'
import {anyControlDragging} from './dragState'
import {createFullbodyControls} from './fullbodyControls'
import {resolveFullbodyRig} from './fullbodyPoints'
import {commitPoseSession, preparePoseSession} from './poseTrack'
import type {PreparePose} from './poseTrack'
import {
  supportedModesForSelection,
  resolvePoseModeSwitch,
} from './selectionModes'
import {
  clearPoseSession,
  getPoseManipulatorMode,
  getPoseSelectionModes,
  getPoseSession,
  isPoseDirty,
  markPoseDirty,
  onPoseExitRequested,
  onPoseManipulatorModeChange,
  setPoseHitTester,
  setPoseManipulatorMode,
  setPoseSelectionModes,
  setPoseSessionFrame,
  usePoseSession,
} from './poseSession'
import type {PoseManipulatorMode} from './poseSession'
import {registerPoseSessionRig} from '../agent/runtime/poseSessionRuntime'
import {getExportAnimationTime} from '../videoExport/exportAnimationClock'

export function PoseModeRig({
  instance,
  sheetObject,
  placementKey,
  sheet,
  preparePose,
}: {
  instance: Group
  sheetObject: ISheetObject<any>
  placementKey: string
  sheet: ISheet
  preparePose?: PreparePose
}): null {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  // drei makeDefault 的轨道控制器:拖控制球期间锁住,防视角跟转
  const orbitControls = useThree((s) => s.controls) as unknown as {
    enabled: boolean
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const ctlRef = useRef<
    | ReturnType<typeof createFullbodyControls>
    | ReturnType<typeof createLegacyControls>
    | null
  >(null)
  const solverRef = useRef<'fullbody' | 'legacy'>('fullbody')
  const pressingRef = useRef(false)
  const lastSelectedRef = useRef<string | null>(null)
  const session = usePoseSession()
  const preparePoseRef = useRef(preparePose)
  preparePoseRef.current = preparePose

  useEffect(() => {
    if (!session || session.key !== placementKey) return
    // 播放中进会话:先暂停(spec §8.1.1)——否则播放头锁与播放钟打架,
    // Rig 的 useFrame 播放时早退 IK 永不求解;脏 Esc 还会把 mixer 帧
    // 烤进姿势关键帧。必须在 determinePoseFrameMode 读 position 之前,
    // 保证读到的播放头稳定
    if (val(sheet.sequence.pointer.playing)) sheet.sequence.pause()
    const rootBone = findRootBone(instance)
    if (!rootBone) {
      clearPoseSession()
      return
    }
    const frame = preparePoseSession(
      session,
      instance,
      sheetObject,
      preparePoseRef.current,
    )
    instance.updateMatrixWorld(true)
    if (frame) setPoseSessionFrame(placementKey, frame)
    let orbitWasEnabled: boolean | undefined
    const dragControl = {
      lock() {
        if (!orbitControls || orbitWasEnabled !== undefined) return
        orbitWasEnabled = orbitControls.enabled
        orbitControls.enabled = false
      },
      unlock() {
        if (!orbitControls || orbitWasEnabled === undefined) return
        orbitControls.enabled = orbitWasEnabled
        orbitWasEnabled = undefined
      },
    }
    const mountControls = () => {
      ctlRef.current?.flush()
      ctlRef.current?.dispose()
      pressingRef.current = false
      instance.updateMatrixWorld(true)
      const facing = deriveHumanoidFacing(instance) ?? new Vector3(0, 0, -1)
      const scale = measureSkeletonScale(instance)
      const fullbody = resolveFullbodyRig(instance, facing)
      const context = {scene, camera, dom: gl.domElement, scale, dragControl}
      const ctl = fullbody
        ? createFullbodyControls({
            ...context,
            rig: fullbody,
            invalidate,
            onEdit: markPoseDirty,
          })
        : createLegacyControls(instance, rootBone, facing, context)
      ctlRef.current = ctl
      solverRef.current = fullbody ? 'fullbody' : 'legacy'
      lastSelectedRef.current = null
      setPoseSelectionModes({move: true, rotate: true})
      ctl?.setManipulatorMode(getPoseManipulatorMode())
      ;(window as any).__poseDebug = {
        ctl,
        camera,
        engine: solverRef.current,
        instance,
      }
      invalidate()
    }
    mountControls()
    if (!ctlRef.current) {
      delete (window as any).__poseDebug
      clearPoseSession()
      return
    }

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
      // 单模式点门禁:与浮条按钮禁用同一数据源,快捷键也不许切到不可用模式
      const support = getPoseSelectionModes()
      if (ev.code === 'KeyW') {
        if (!support.move) return
        setPoseManipulatorMode('move')
      } else if (ev.code === 'KeyE') {
        if (!support.rotate) return
        setPoseManipulatorMode('rotate')
      } else return
      invalidate() // demand 帧循环:无指针按下时补帧,环/箭头立刻可见
    }
    window.addEventListener('keydown', onKey)

    // 共享状态 → threeIK:小条按钮切换时转发;进会话用记住的偏好初始化
    const offMode = onPoseManipulatorModeChange((m) => {
      ctlRef.current?.setManipulatorMode(m)
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
      const balls =
        ctlRef.current?.targets
          .map((t) => t.ball)
          .filter((ball) => ball.visible) ?? []
      return raycaster.intersectObjects([instance, ...balls], true).length > 0
    })

    const lockedPosition = sheet.sequence.position
    const offPosition =
      session.target === 'draft'
        ? undefined
        : onChange(sheet.sequence.pointer.position, (position) => {
            if (
              getPoseSession() === session &&
              Math.abs(position - lockedPosition) > 1e-6
            ) {
              sheet.sequence.position = lockedPosition
            }
          })

    const commitSession = (force = false) => {
      if (getPoseSession() !== session) return
      try {
        if (force || isPoseDirty()) {
          ctlRef.current?.flush()
          commitPoseSession(session, instance, sheetObject, frame)
        }
      } finally {
        if (getPoseSession() === session) clearPoseSession()
      }
    }
    const cancelSession = () => {
      if (getPoseSession() !== session) return
      clearPoseSession()
      if (session.target === 'draft') session.draft.onCancel?.()
    }
    const offExit = onPoseExitRequested((key, action) => {
      if (key !== placementKey || getPoseSession() !== session) return
      if (
        action === 'cancel' ||
        (session.target === 'draft' && action !== 'save')
      )
        cancelSession()
      else commitSession(action === 'save')
    })

    // Agent 姿势会话句柄(poses.session.commit/cancel):commit 与 UI 退出
    // 同一提交路径;cancel 不写回,会话清除后姿势应用 effect 把当前值
    // 补刷回骨骼(poseModeActive 翻转触发,见 PlacementManager)
    const unregisterSessionRig = registerPoseSessionRig(placementKey, {
      get fullbody() {
        const controls = ctlRef.current
        return controls && 'setIkTarget' in controls ? controls : undefined
      },
      commit: commitSession,
      cancel: cancelSession,
    })

    invalidate() // 进姿势模式首帧:控制球立刻可见
    return () => {
      unregisterSessionRig()
      offExit()
      offMode()
      offPosition?.()
      setPoseHitTester(null)
      window.removeEventListener('keydown', onKey)
      ctlRef.current?.dispose()
      ctlRef.current = null
      lastSelectedRef.current = null
      delete (window as any).__poseDebug
      // 会话外因素卸载(模型被删等):实例已毁,跳过提交只清会话态。
      // 按键清:A→B 直接切换时 session 已是 B,不能把它抹掉(切换坍塌)
      if (getPoseSession() === session) clearPoseSession()
      invalidate()
    }
  }, [
    instance,
    sheetObject,
    placementKey,
    session,
    sheet,
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
      if (ctl && solverRef.current === 'legacy') {
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
    window.addEventListener('pointercancel', up)
    return () => {
      dom.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [gl, camera, invalidate])

  useFrame((_, delta) => {
    const ctl = ctlRef.current
    if (!ctl) return
    // 离线导出由导出核心逐帧写姿势;绝不能用导出帧的毫秒 delta 推 IK。
    if (getExportAnimationTime() !== null) return
    if (val(sheet.sequence.pointer.playing)) return // 播放时 mixer 写骨骼,不抢
    ctl.update(delta)
    // 选中态轮询:threeIK 无选中事件,getSelected() 是便宜字段读。
    // 变化时刷新支持集(浮条禁用)并自动切到可用模式(单模式点)
    const sel = ctl.getSelected()
    if (sel !== lastSelectedRef.current) {
      lastSelectedRef.current = sel
      const support = ctl.getSelectionModes()
      setPoseSelectionModes(support)
      const next = resolvePoseModeSwitch(support, getPoseManipulatorMode())
      if (next) setPoseManipulatorMode(next)
    }
    if (pressingRef.current) invalidate()
  })

  return null
}

function createLegacyControls(
  instance: Group,
  rootBone: NonNullable<ReturnType<typeof findRootBone>>,
  facing: Vector3,
  {
    scene,
    camera,
    dom,
    scale,
    dragControl,
  }: {
    scene: Parameters<typeof createSkeletonControls>[0]['scene']
    camera: Parameters<typeof createSkeletonControls>[0]['camera']
    dom: HTMLCanvasElement
    scale: number
    dragControl: NonNullable<
      Parameters<typeof createSkeletonControls>[0]['dragControl']
    >
  },
) {
  const spec = resolveControlSpec(instance, facing)
  if (!spec) return null
  const rig = new SkeletonRig(rootBone)
  rig.on('warning', (payload) =>
    console.warn('[poseMode]', (payload as {message?: string})?.message),
  )
  rig.captureBasePose()
  const ctl = createSkeletonControls({
    rig,
    scene,
    camera,
    dom,
    controls: spec,
    facing,
    defaults: {
      rootRadius: 0.4 * scale,
      lookAtRadius: 0.35 * scale,
      joystickRadius: 0.16 * scale,
    },
    dragControl,
    hotkeys: false,
  })
  const names = spec.map((point) => point.name)
  const handles = names.map((name) => ctl.get(name))
  for (const handle of handles) handle?.setActive(false)
  rig.update(0)
  for (const handle of handles) handle?.setActive(true)
  instance.updateMatrixWorld(true)
  for (const point of spec) {
    if (point.kind !== 'limb') continue
    const limb = point as LimbControlSpec
    const handle = ctl.get<LimbControlHandle>(limb.name)
    if (!handle) continue
    const root = instance.getObjectByName(limb.rootBone)
    const middle = instance.getObjectByName(limb.middleBone)
    const end = instance.getObjectByName(limb.endBone)
    if (!root || !middle || !end) continue
    const rootPos = root.getWorldPosition(new Vector3())
    const axis = end.getWorldPosition(new Vector3()).sub(rootPos)
    if (axis.lengthSq() < 1e-12) continue
    axis.normalize()
    const bend = middle.getWorldPosition(new Vector3()).sub(rootPos)
    bend.addScaledVector(axis, -bend.dot(axis))
    if (bend.lengthSq() < 1e-10) continue
    handle.pole.setDirection(bend)
    const poleDir = handle.pole.ball
      .getWorldPosition(new Vector3())
      .sub(rootPos)
    poleDir.addScaledVector(axis, -poleDir.dot(axis))
    if (poleDir.lengthSq() < 1e-10) continue
    poleDir
      .normalize()
      .applyQuaternion(middle.getWorldQuaternion(new Quaternion()).invert())
    handle.modifier.updateConfig(0, {
      poleDirection: 'custom',
      poleDirectionVector: poleDir,
    })
  }
  ctl.update()
  for (const target of ctl.targets) target.ball.scale.multiplyScalar(scale)
  for (const point of spec) {
    if (point.kind === 'limb')
      ctl
        .get<LimbControlHandle>(point.name)
        ?.pole.ball.scale.multiplyScalar(scale)
  }
  return {
    targets: ctl.targets,
    getSelected: () => ctl.getSelected(),
    setManipulatorMode: (mode: PoseManipulatorMode) =>
      ctl.setManipulatorMode(mode),
    dispose: () => ctl.dispose(),
    getSelectionModes: () =>
      supportedModesForSelection(spec, ctl.getSelected()),
    update(delta: number) {
      rig.update(delta)
      ctl.update()
      if (anyControlDragging(ctl, names)) markPoseDirty()
    },
    flush() {
      rig.update(0)
      ctl.update()
    },
  }
}
