// packages/camera-studio/src/poseMode/PoseModeRig.tsx
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
  const rigRef = useRef<SkeletonRig | null>(null)
  const ctlRef = useRef<ReturnType<typeof createSkeletonControls> | null>(null)
  const pressingRef = useRef(false)
  const dirtyRef = useRef(false)
  const controlNamesRef = useRef<string[]>([])
  // 装配表/选中名:useFrame 轮询选中态用(支持集推导 + 单模式点自动切换)
  const specRef = useRef<ReturnType<typeof resolveControlSpec>>(null)
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
    // 解剖学朝向(髋×脊柱反推,与模型局部轴向约定/放置旋转无关):
    // 不传则库默认 (0,0,-1)——Y Bot 这类面朝 +Z 的模型注视球会生在脑后、拖球镜像
    const facing = deriveHumanoidFacing(instance) ?? new Vector3(0, 0, -1)
    const spec = resolveControlSpec(instance, facing)
    if (!spec) {
      // 入口已拦(菜单置灰/双击静默),这里是防御:直接清会话不挂载
      clearPoseSession()
      return
    }
    if (frame) setPoseSessionFrame(placementKey, frame)
    const rig = new SkeletonRig(rootBone)
    rigRef.current = rig
    specRef.current = spec
    lastSelectedRef.current = null
    rig.on('warning', (payload) =>
      console.warn('[poseMode]', (payload as {message?: string})?.message),
    )
    // 基准 = 当前姿势:没被控制点覆盖的骨骼保持原样,不弹回绑定姿势
    rig.captureBasePose()
    controlNamesRef.current = spec.map((c) => c.name)
    dirtyRef.current = false
    const sizeScale = measureSkeletonScale(instance)
    // 尺寸语义随 0.1.0 换芯拆分:ringRadius/ballRadius 已变成操纵器屏尺寸倍率
    // (÷类默认后传给 TransformControls.size,gizmo 屏幕恒定大小)——乘 sizeScale
    // 会把 gizmo 放大成 sizeScale 倍屏尺寸(0.0.1 的世界尺寸语义已作废),保持默认;
    // rootRadius(重心活动球域)、lookAtRadius(注视球恒距)与 joystickRadius(头顶摇杆
    // 球离头距离,0.2.1 起独立默认项)仍是世界单位语义,随骨架等比
    const ctl = createSkeletonControls({
      rig,
      scene,
      camera,
      dom: gl.domElement,
      controls: spec,
      facing,
      defaults: {
        rootRadius: 0.4 * sizeScale,
        lookAtRadius: 0.35 * sizeScale,
        // 0.16×倍率 ≈ 球心嵌头顶表面内侧:球收进头部轮廓内偏顶,不悬空(0.35 注视
        // 距离会悬在头顶上方一截);球 depthTest:false 透显,嵌入头内仍可见可拖
        // (命中是纯数学判定,头部网格不挡);推杆时球沿贴头球面滑动
        joystickRadius: 0.16 * sizeScale,
      },
      dragControl: {
        lock: () => {
          if (orbitControls) orbitControls.enabled = false
        },
        unlock: () => {
          if (orbitControls) orbitControls.enabled = true
        },
      },
      // 0.1.0 起装配器内置 Maya 热键(W/E/Escape)默认绑 window:W/E 与我们
      // 自监听(经 poseSession 共享状态、浮条高亮同源)双触发,Escape 会抢
      // 退出会话。全关,自绑路径不变
      hotkeys: false,
    })
    ctlRef.current = ctl
    // threeIK 构造期会先用尚未落位的 pole（世界原点）求解一次，手臂/腿会
    // 被拧到另一套弯折平面。这里先临时关闭所有 modifier，把骨骼恢复成
    // 进入会话时捕获的基准姿势，再按当前肘/膝的真实弯折方向重置 pole。
    const handles = spec.map((point) => ctl.get(point.name))
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
      const middlePos = middle.getWorldPosition(new Vector3())
      const endPos = end.getWorldPosition(new Vector3())
      const axis = endPos.clone().sub(rootPos)
      if (axis.lengthSq() < 1e-12) continue
      axis.normalize()
      const bend = middlePos.clone().sub(rootPos)
      bend.addScaledVector(axis, -bend.dot(axis))
      if (bend.lengthSq() < 1e-10) continue
      handle.pole.setDirection(bend)
      const poleDir = handle.pole.ball
        .getWorldPosition(new Vector3())
        .sub(rootPos)
      poleDir.addScaledVector(axis, -poleDir.dot(axis))
      if (poleDir.lengthSq() < 1e-10) continue
      poleDir.normalize()
      poleDir.applyQuaternion(
        middle.getWorldQuaternion(new Quaternion()).invert(),
      )
      handle.modifier.updateConfig(0, {
        poleDirection: 'custom',
        poleDirectionVector: poleDir.clone(),
      })
    }
    ctl.update()
    // 视觉球网格随骨架等比放大(ballRadius 保持类默认 → manipulatorSize 恒 1,
    // gizmo 标准屏尺寸)。multiplyScalar 而非 setScalar:标记球(胸口/肩髋)自带
    // 0.7 身份缩放(MARKER_SCALE),要保住相对大小;DragTarget 只在射线检测读
    // ball.scale,从不覆写,外部设置安全
    for (const t of ctl.targets) t.ball.scale.multiplyScalar(sizeScale)
    // 四肢 pole(PoleOrbit)不是 DragTarget、不在 ctl.targets,按 spec 的 limb 名
    // 从句柄取出补同样的等比;其射线容差随相机距离走(cameraDist×0.011,远大于
    // 球径),网格等比后点按区域不受影响
    for (const c of spec) {
      if (c.kind !== 'limb') continue
      ctl
        .get<LimbControlHandle>(c.name)
        ?.pole.ball.scale.multiplyScalar(sizeScale)
    }
    // 调试/自动化验证挂钩(同 __cameraShot):浏览器冒烟直接读选中态
    // (getSelected)与各控制球世界坐标,免去按像素猜点
    ;(window as any).__poseDebug = {ctl, camera}

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
        if (force || dirtyRef.current || isPoseDirty()) {
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
      ctl.dispose()
      ctlRef.current = null
      rigRef.current = null
      specRef.current = null
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
    // 离线导出由导出核心逐帧写姿势;绝不能用导出帧的毫秒 delta 推 IK。
    if (getExportAnimationTime() !== null) return
    if (val(sheet.sequence.pointer.playing)) return // 播放时 mixer 写骨骼,不抢
    rig.update(delta)
    ctl.update()
    // 选中态轮询:threeIK 无选中事件,getSelected() 是便宜字段读。
    // 变化时刷新支持集(浮条禁用)并自动切到可用模式(单模式点)
    const sel = ctl.getSelected()
    if (sel !== lastSelectedRef.current) {
      lastSelectedRef.current = sel
      const support = supportedModesForSelection(specRef.current ?? [], sel)
      setPoseSelectionModes(support)
      const next = resolvePoseModeSwitch(support, getPoseManipulatorMode())
      if (next) setPoseManipulatorMode(next)
    }
    if (!dirtyRef.current && anyControlDragging(ctl, controlNamesRef.current)) {
      dirtyRef.current = true
    }
    if (pressingRef.current) invalidate()
  })

  return null
}
