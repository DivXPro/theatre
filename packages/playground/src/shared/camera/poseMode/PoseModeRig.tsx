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
import {getStudioSync, onChange, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {Raycaster, Vector2} from 'three'
import type {Group} from 'three'
import {SkeletonRig} from '@dreamerbird/threeik'
import {createSkeletonControls} from '@dreamerbird/threeik/controls'
import type {LimbControlHandle} from '@dreamerbird/threeik/controls'
import {capturePose} from '../assetLibrary/pose'
import {
  measureSkeletonScale,
  resolveControlSpec,
  findRootBone,
} from './controlSpec'
import {anyControlDragging} from './dragState'
import {determinePoseFrameMode} from './poseFrame'
import {getPoseKeyframePositions, writePoseKeyframe} from './poseTrack'
import {serializeCustomPose} from './poseValue'
import {
  supportedModesForSelection,
  resolvePoseModeSwitch,
} from './selectionModes'
import {
  clearPoseSession,
  clearPoseSessionIfCurrent,
  getPoseManipulatorMode,
  getPoseSelectionModes,
  getPoseSessionFrame,
  isPoseDirty,
  markPoseDirty,
  onPoseExitRequested,
  onPoseManipulatorModeChange,
  setPoseHitTester,
  setPoseManipulatorMode,
  setPoseSelectionModes,
  setPoseSessionFrame,
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
  // 装配表/选中名:useFrame 轮询选中态用(支持集推导 + 单模式点自动切换)
  const specRef = useRef<ReturnType<typeof resolveControlSpec>>(null)
  const lastSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    // 播放中进会话:先暂停(spec §8.1.1)——否则播放头锁与播放钟打架,
    // Rig 的 useFrame 播放时早退 IK 永不求解;脏 Esc 还会把 mixer 帧
    // 烤进姿势关键帧。必须在 determinePoseFrameMode 读 position 之前,
    // 保证读到的播放头稳定
    if (val(sheet.sequence.pointer.playing)) sheet.sequence.pause()
    const rootBone = findRootBone(instance)
    const spec = resolveControlSpec(instance)
    if (!rootBone || !spec) {
      // 入口已拦(菜单置灰/双击静默),这里是防御:直接清会话不挂载
      clearPoseSession()
      return
    }
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
    // rootRadius(重心活动球域)与 lookAtRadius(注视球恒距)仍是世界单位语义,随骨架等比
    const ctl = createSkeletonControls({
      rig,
      scene,
      camera,
      dom: gl.domElement,
      controls: spec,
      defaults: {
        rootRadius: 0.4 * sizeScale,
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
      // 0.1.0 起装配器内置 Maya 热键(W/E/Escape)默认绑 window:W/E 与我们
      // 自监听(经 poseSession 共享状态、浮条高亮同源)双触发,Escape 会抢
      // 退出会话。全关,自绑路径不变
      hotkeys: false,
    })
    ctlRef.current = ctl
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
      ctl.get<LimbControlHandle>(c.name)?.pole.ball.scale.multiplyScalar(sizeScale)
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

    // 帧模式判定(spec §8.1):贴网格后帧上=编辑、帧间=新建;底姿由
    // 既有应用 effect 保证(非播放时画面恒为播放头求值,所见即所编)
    const frame = determinePoseFrameMode(
      getPoseKeyframePositions(sheetObject),
      sheet.sequence.position,
      (t) => sheet.sequence.closestGridPosition(t),
    )
    sheet.sequence.position = frame.position
    setPoseSessionFrame(placementKey, frame)

    // 锁播放头(spec §8.1.4):会话期间 position 被挪动即拉回会话时刻
    const offPosition = onChange(sheet.sequence.pointer.position, (pos) => {
      if (Math.abs((pos as number) - frame.position) > 1e-6) {
        sheet.sequence.position = frame.position
      }
    })

    // 退出提交:捕获实时骨骼 → 写姿势轨关键帧(可撤销,经 writePoseKeyframe)
    const offExit = onPoseExitRequested((key) => {
      if (key !== placementKey) return
      const studio = getStudioSync()
      // 脏检查:没拖过控制点就不提交(threeIK 首解有微小漂移,
      // 空进空出写回会产生幻影撤销步;语义对齐 modalGrab 的 moved)。
      // 双通道或:dirtyRef 由 isDragging 轮询记(帧间隙完整的拖动),
      // isPoseDirty 由 pointerdown 事件记(同帧间隙的按下-拖-松,轮询漏检)
      if (studio && (dirtyRef.current || isPoseDirty())) {
        const bones = capturePose(instance)
        // 写帧(spec §7.2):帧上=覆盖、帧间=新建、无轨=建轨+首帧;
        // 先把播放头钉回会话时刻(锁定期间理论不动,双保险)
        const frame = getPoseSessionFrame()
        if (frame) sheet.sequence.position = frame.position
        writePoseKeyframe(sheetObject, serializeCustomPose(bones))
      }
      clearPoseSession()
    })

    invalidate() // 进姿势模式首帧:控制球立刻可见
    return () => {
      offExit()
      offMode()
      offPosition()
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
