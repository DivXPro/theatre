import {editable as e, SheetProvider, PerspectiveCamera} from '@dreamerbird/r3f'
import {
  Grid,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei'
import {getStudioSync, onChange, val} from '@dreamerbird/core'
// 诊断撤销栈用:模块级单例直达私有 Studio(getStudioSync 返回的是 publicApi,
// 空构造不存 internals,摸不到 _store._saaz——TheatreStudio.ts:121)
import getStudio from '@dreamerbird/studio/getStudio'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import getDeep from './getDeep'
import {usePrism, useVal} from '@dreamerbird/react'
import type {IScrub, ISheet, ISheetObject} from '@dreamerbird/core'
import React, {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {MutableRefObject} from 'react'
import {Canvas, useFrame, useThree} from '@react-three/fiber'
import {useT} from '@dreamerbird/studio/i18n'
import {I18nContext, I18nProvider, setLanguage} from '@dreamerbird/studio/i18n'
import type {ThreeEvent} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import sceneGLB from './scene.glb'
import {
  Color,
  Euler,
  LinearSRGBColorSpace,
  MOUSE,
  PMREMGenerator,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
} from 'three'
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js'
import type {Mesh, Object3D} from 'three'
import {
  PlacementRig,
  PlacementRigErrorBoundary,
  PlacedModels,
  SelectionGizmo,
  deletePlacement,
  getPlacementEntryForObject,
  getPlacementInstanceForObject,
  isSelectSuppressed,
  readPlacementEntries,
  readPlacementPositions,
  useGizmoMode,
  usePlacementController,
  usePlacementSurface,
  useSelectionGizmoTarget,
} from './PlacementManager'
import {CanvasContextMenu} from './contextMenu'
import {registerEditorOnly} from './editorOnly'
import {
  buildAnchorMenuItems,
  buildCameraMenuItems,
  buildObjectMenuItems,
  buildPathMenuItems,
} from './menuModel'
import {TopToolbar} from './TopToolbar'
import {Anchors} from './Anchors'
import {collectAnchorChildResets, setAimOptionsSheet} from './aimTargets'
import {
  addAnchorToRegistry,
  nextAnchorKey,
  removeAnchor,
  useAnchorsList,
} from './anchorsRegistry'
import type {AnchorSeed} from './anchorsRegistry'
import {PipCameraSelector} from './PipCameraSelector'
import {usePipBottom} from './pipLayout'
import {bindUndoShortcuts, isInsideStudioUi} from './undoShortcuts'
import {AssetLibraryPanel} from './assetLibrary/AssetLibraryPanel'
import {ModelPickerSlot} from './assetLibrary/ModelPickerSlot'
import {getLibrary, useLibraryEntries} from './assetLibrary/library'
import {ShotCamera} from './ShotCamera'
import {
  addCameraToRegistry,
  getCamerasRegistry,
  nextCameraEntry,
  readCameraEntries,
  removeCamera,
  resolveActiveCamera,
  useCamerasList,
} from './cameraRegistry'
import type {CameraEntry, CameraSeed} from './cameraRegistry'
import type {GizmoMode} from './PlacementManager'
import {
  addPathPoint,
  CameraPath,
  deletePathPoint,
  getPathMeta,
  PathEditBar,
  PathPointEditor,
  pathExists,
  POS_PATH_KEY,
  readPathPoints,
  samplePathPoint,
  usePathExists,
} from './CameraPath'
import {
  addPathToRegistry,
  nextPathEntry,
  readPathEntries,
  getPathsRegistry,
  removePathFromRegistry,
  usePathsList,
} from './pathRegistry'
import type {BoundCameraReset} from './pathRegistry'
import {resolveBoundPathKey} from './pathBinding'
import {deletePathDomain} from './agent/pathCommands'
import {formatSceneObjectId} from './agent/objectIds'
import {getSceneSheetObject} from './agent/runtime/objectRuntime'
import type {SceneObjectKind} from './agent/types'
import {bindCameraStudioSceneHandlers} from './agent/api'
import type {AgentSceneRuntimeHandlers} from './agent/runtime'
import {registerDirectorView} from './agent/runtime/directorView'
import type {DirectorViewController} from './agent/runtime/directorView'
import {findFreeSpot, presetPlacement} from './pathPresets'
import type {PathPreset} from './pathPresets'
import {PathPresetDropRig} from './PathPresetDropRig'
import {listSinks} from './videoExport/sinks'
import type {ExportSink} from './videoExport/sinks'
import type {ShotExportHandle} from './videoExport/exporter'
import {
  createSceneExportController,
  registerSceneExportController,
} from './agent/runtime/exportRuntime'
import type {AnimationEntry, ModelEntry, PoseEntry} from './assetLibrary/types'
import {rigIdOf, collectBoneNames} from './assetLibrary/rig'
import {
  cameraOutlineMenuExtensionId,
  cameraOutlineObjectMenu,
  setCameraOutlineMenuCtx,
} from './outlineObjectMenu'
import {pruneObjectFromOutlineCollections} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/stateOps'
import {
  createHostFlows,
  setDropPointContext,
  setHostFlowsHandle,
  setPlacingSnapshot,
} from './hostFlows'
import type {CameraFlows, HostFlowDeps} from './hostFlows'
import {importModelFile} from './assetLibrary/importModelFile'
import {resolveControlSpec} from './poseMode/controlSpec'
import type {CameraSceneProps} from './config'
import {getUiConfig} from './uiConfig'
import {
  createFirstScreenGate,
  getFirstScreenGate,
  installFirstScreenGate,
  resetFirstScreenGate,
} from './firstScreenGate'
import {
  enterPoseSession,
  getPoseSession,
  isModelDoubleClick,
  poseHitTest,
  requestPoseExit,
  usePoseSessionKey,
} from './poseMode/poseSession'
import {
  getPoseKeyframeCount,
  setPoseValue,
  writePoseKeyframe,
  clearPoseValue,
} from './poseMode/poseTrack'
import {savePoseFromInstance} from './poseMode/savePose'
import {parsePoseValue, serializeLibPose} from './poseMode/poseValue'
import {isPoseExitGuardedTarget} from './poseMode/poseExitGuard'
import {poseStatusText} from './poseStatusText'

/** 首屏闸门里场景内置模型(scene.glb)的登记 key */
const SCENE_MODEL_GATE_KEY = 'scene-glb'

/**
 * 加载探针:Suspense 未解决时子树不挂载,mount effect 触发即
 * 「这个资源落定了」,上报首屏闸门(firstScreenGate 机制)
 */
function InitialLoadProbe({
  gateKey,
  children,
}: {
  gateKey: string
  children: React.ReactNode
}) {
  useEffect(() => {
    getFirstScreenGate().settle(gateKey)
  }, [gateKey])
  return <>{children}</>
}

function Model({url, selectLocked}: {url: string; selectLocked?: boolean}) {
  const {nodes} = useGLTF(url) as any
  const thingyObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  // 登记为放置落点表面:放置 FBX 时射线检测只打这里和已放置的模型
  const surfaceRef = useRef<Object3D>(null!)
  usePlacementSurface(surfaceRef)
  // 登记为选中 gizmo 的附着目标:选中 Thingy 后挂三轴移动箭头
  const thingyGroupRef = useRef<Object3D>(null!)
  useSelectionGizmoTarget(thingyObjRef, thingyGroupRef)
  // 两个碎片子网格同样登记:大纲里单独选中它们时也有箭头、可按 G
  // (视口点碎片会冒泡选中整个 Thingy,单独选只能走大纲,和 Blender 一致)
  const debris1ObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const debris1Ref = useRef<Mesh>(null!)
  useSelectionGizmoTarget(debris1ObjRef, debris1Ref)
  const debris2ObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const debris2Ref = useRef<Mesh>(null!)
  useSelectionGizmoTarget(debris2ObjRef, debris2Ref)

  // 主画面点选:r3f 对网格做射线检测,点击任意子网格会冒泡到分组。
  // 拖拽转视角后松手不算点击(r3f 的 delta 判定),两者不冲突。
  const selectThingy = (event: ThreeEvent<MouseEvent>) => {
    // 放置模式下点击是确认落点:不选中,也不拦截事件,让它落到
    // PlacementRig 的地面网格上完成确认;点 gizmo 箭头穿透过来的误点也吞掉
    if (selectLocked || isSelectSuppressed()) return
    // 姿势会话中点击其他对象不响应(规格:不抢选中)——被摆模型的选中不动
    if (getPoseSession()) return
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && thingyObjRef.current) {
      studio.setSelection([thingyObjRef.current])
    }
  }

  // scene.glb 里 planet.001 是不带几何体的空分组节点,
  // 真正有几何体的是 planet.002 / planet.003 两个子节点。
  // 因此 Thingy 挂在分组上(e.group),拖动它即拖动整个模型。
  return (
    <group
      ref={surfaceRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -7, 0]}
      scale={7}
    >
      <e.group
        ref={thingyGroupRef}
        theatreKey="Thingy"
        objRef={thingyObjRef}
        onClick={selectThingy}
        rotation={[Math.PI / 13.5, -Math.PI / 5.8, Math.PI / 5.6]}
      >
        <e.mesh
          theatreKey="Thingy / Debris 2"
          objRef={debris2ObjRef}
          ref={debris2Ref}
          receiveShadow
          castShadow
          geometry={nodes.planet002.geometry}
          material={nodes.planet002.material}
        />
        <e.mesh
          theatreKey="Thingy / Debris 1"
          objRef={debris1ObjRef}
          ref={debris1Ref}
          geometry={nodes.planet003.geometry}
          material={nodes.planet003.material}
        />
      </e.group>
    </group>
  )
}

/**
 * 导演视角初始机位/瞄准点:PerspectiveCamera/Target 的 JSX position 与
 * Agent view.reset(MainOrbitControls 登记的导演控制器)同源,改一处
 * 两处一致。场景单位 = 米:机位 4.5 米外、1.7 米高,瞄准胸口(0.9 米),
 * 一个 1.8 米的人占画面约四成高,是舒服的工作取景。
 */
const DIRECTOR_HOME_CAMERA_POSITION: [number, number, number] = [0, 1.7, 4.5]
const DIRECTOR_HOME_TARGET_POSITION: [number, number, number] = [0, 0.9, 0]

/**
 * 主画面的视角控制,操作方式与 Blender 默认键位一致:
 *   中键拖动 = 旋转视角;Shift+中键 = 平移;Ctrl/Cmd+中键 = 平滑缩放;
 *   滚轮 = 缩放;左键不驱动视角(留给点选,和 Blender 的分工一致)。
 * 场景的语义是"相机始终对准 Camera / Target 对象"(PerspectiveCamera 每帧
 * lookAt),因此平移实现为:把 OrbitControls 的新瞄准点写回 Target 对象的
 * 位置属性,让 Target 网格跟着走——不打架,还能持久化和同步。
 * 拖拽过程中把相机位置和瞄准点实时写回 theatre,studio 里的数据和画面
 * 保持一致,没有 studio 时(发布的应用)只在本地生效。
 */
function MainOrbitControls({
  targetRef,
  cameraObjRef,
  targetObjRef,
  enabled = true,
}: {
  targetRef: React.MutableRefObject<Object3D>
  cameraObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
  targetObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
  /** 镜头视角下停用:轨道控制器绑的是默认相机,不抢镜头画面 */
  enabled?: boolean
}) {
  // 用 state 而不是 ref 持有控制器:默认相机切换(makeDefault)时 drei 会
  // 重建 OrbitControls 实例,ref 回调会再次触发,监听才能挂到活着的实例上
  const [controls, setControls] = useState<any>(null)
  // 拖拽期间(尤其平移)不把 Target 网格位置同步回瞄准点:平移刚写完
  // theatre,网格位置要等下一拍才更新,此时回读会把瞄准点拽回旧值
  const draggingRef = useRef(false)

  // 瞄准点跟随 Target 对象的位置(Target 在编辑器里被拖动时也能跟上)
  useFrame(() => {
    const target = targetRef.current
    if (
      controls &&
      target &&
      !draggingRef.current &&
      !controls.target.equals(target.position)
    ) {
      controls.target.copy(target.position)
      controls.update()
    }
  })

  useLayoutEffect(() => {
    if (!controls) return

    let scrub: IScrub | undefined

    const onStart = () => {
      draggingRef.current = true
      const studio = getStudioSync()
      if (!studio) return
      scrub = studio.scrub()
    }
    const onChange = () => {
      const cameraObj = cameraObjRef.current
      if (!scrub || !cameraObj) return
      const p = controls.object.position
      const t = controls.target
      try {
        scrub.capture(({set}) => {
          set(cameraObj.props.position, {x: p.x, y: p.y, z: p.z})
          const targetObj = targetObjRef.current
          if (targetObj) {
            set(targetObj.props.position, {x: t.x, y: t.y, z: t.z})
          }
        })
      } catch (err) {
        // capture 抛错后 scrub 已被标记为 Discarded(不可再用)。扔掉引用,
        // 放弃本次拖拽的剩余改动——否则之后每个 change 事件都会重复抛错刷屏
        console.warn('[camera] 相机 scrub 失效,本次拖拽的剩余改动被放弃', err)
        scrub = undefined
      }
    }
    const onEnd = () => {
      draggingRef.current = false
      const s = scrub
      scrub = undefined
      try {
        // 编辑器视角是视图态不是场景内容:持久化+同步,但不进撤销历史
        s?.commit(false)
      } catch (err) {
        // scrub 已失效时 commit 会抛错,不能让它阻止引用清理
        console.warn('[camera] 相机 scrub 提交失败', err)
      }
    }

    controls.addEventListener('start', onStart)
    controls.addEventListener('change', onChange)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('end', onEnd)
      scrub?.discard()
    }
  }, [controls, cameraObjRef, targetObjRef])

  // Ctrl/Cmd 按住期间把中键从"旋转"临时切换为"缩放"(Blender 的 Ctrl+中键);
  // OrbitControls 只内置了"旋转+修饰键→平移",不支持修饰键切缩放,所以自己换
  useLayoutEffect(() => {
    if (!controls) return
    const toDolly = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        controls.mouseButtons.MIDDLE = MOUSE.DOLLY
      }
    }
    const toRotate = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        controls.mouseButtons.MIDDLE = MOUSE.ROTATE
      }
    }
    // 窗口失焦时复位,避免 Ctrl 在窗外松开导致中键一直停在缩放
    const reset = () => {
      controls.mouseButtons.MIDDLE = MOUSE.ROTATE
    }
    window.addEventListener('keydown', toDolly)
    window.addEventListener('keyup', toRotate)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', toDolly)
      window.removeEventListener('keyup', toRotate)
      window.removeEventListener('blur', reset)
    }
  }, [controls])

  // 触控板手势对齐 Blender:双指滑动=旋转视角,捏合=缩放,鼠标滚轮保持缩放。
  // 浏览器里三者都是 wheel 事件,区分方式:
  //   捏合     —— 事件带 ctrlKey(macOS 的 Chrome/Safari 都这么报),放行给 OrbitControls 缩放
  //   鼠标滚轮 —— delta 是大的整数值(Chrome 约 ±100 的倍数,Firefox 用行距模式),放行缩放
  //   双指滑动 —— 小而密的像素 delta(常带小数),拦下来自己转成旋转。
  // 启发式不是 100% 可靠:触控板快速甩动偶尔会被当成滚轮(变成缩放),可接受。
  useLayoutEffect(() => {
    if (!controls) return
    const element = controls.domElement as HTMLElement
    const spherical = new Spherical()
    const offset = new Vector3()
    const panOffset = new Vector3()
    const EPS = 0.000001

    const isMouseWheel = (e: WheelEvent) =>
      e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50)

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || isMouseWheel(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()

      // Shift+双指滑动 = 平移(Blender 的 Shift+中键):相机和瞄准点一起移,
      // 换算与 OrbitControls 内部的 panLeft/panUp 一致,但方向取反——
      // Blender 是"视角跟着鼠标方向走",OrbitControls 默认是"内容跟着鼠标走"
      if (e.shiftKey) {
        if (controls.enablePan === false) return
        const camera = controls.object
        offset.copy(camera.position).sub(controls.target)
        const targetDistance =
          offset.length() * Math.tan(((camera.fov / 2) * Math.PI) / 180)
        const panX = (2 * e.deltaX * targetDistance) / element.clientHeight
        const panY = (2 * e.deltaY * targetDistance) / element.clientHeight
        panOffset
          .setFromMatrixColumn(camera.matrix, 0)
          .multiplyScalar(panX)
          .add(
            offset.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-panY),
          )
        if (panOffset.lengthSq() < EPS) return

        controls.dispatchEvent({type: 'start'})
        camera.position.add(panOffset)
        controls.target.add(panOffset)
        controls.update()
        controls.dispatchEvent({type: 'end'})
        return
      }

      if (controls.enableRotate === false) return

      // 与 OrbitControls 内部 rotateLeft/rotateUp 相同的换算(都除以高度)
      const rotateSpeed = controls.rotateSpeed ?? 1
      const theta =
        ((2 * Math.PI * e.deltaX) / element.clientHeight) * rotateSpeed
      const phi =
        ((2 * Math.PI * e.deltaY) / element.clientHeight) * rotateSpeed

      offset.copy(controls.object.position).sub(controls.target)
      spherical.setFromVector3(offset)
      spherical.theta -= theta
      spherical.phi -= phi
      spherical.phi = Math.max(
        controls.minPolarAngle + EPS,
        Math.min(controls.maxPolarAngle - EPS, spherical.phi),
      )
      offset.setFromSpherical(spherical).add(controls.target)

      // 触控板惯性流里混着大量零增量事件;位置没变化就不派生 start/end,
      // 否则每次都提交一个空 scrub,控制台被 "Scrub is empty" 刷屏
      if (offset.distanceToSquared(controls.object.position) < EPS) return

      // 走和拖拽一样的事件流:start/end 包住 change,写回 theatre 的逻辑直接复用
      controls.dispatchEvent({type: 'start'})
      controls.object.position.copy(offset)
      controls.update()
      controls.dispatchEvent({type: 'end'})
    }

    // capture + stopImmediatePropagation:抢在 OrbitControls 自己的 wheel 监听之前拦下
    element.addEventListener('wheel', onWheel, {passive: false, capture: true})
    return () =>
      element.removeEventListener('wheel', onWheel, {capture: true} as any)
  }, [controls])

  // Agent view.* 导演视角命令(Task 12):把 orbit/pan/dolly/reset 登记到
  // directorView 模块表。四个操作都复用拖拽的事件流(start → 改机位/瞄准点
  // → update → end),写回 theatre 的 scrub 逻辑随之复用;新位置先算好再
  // 派生事件,零增量不产生空 scrub(同触控板 wheel 处理)。cleanup 由
  // registerDirectorView 的同引用校验保证只解绑自己这一代。
  useLayoutEffect(() => {
    if (!controls) return
    const spherical = new Spherical()
    const offset = new Vector3()
    const panOffset = new Vector3()
    const homeCamera = new Vector3()
    const EPS = 0.000001

    const controller: DirectorViewController = {
      orbit({deltaTheta, deltaPhi}) {
        offset.copy(controls.object.position).sub(controls.target)
        spherical.setFromVector3(offset)
        spherical.theta += deltaTheta
        spherical.phi += deltaPhi
        spherical.phi = Math.max(
          controls.minPolarAngle + EPS,
          Math.min(controls.maxPolarAngle - EPS, spherical.phi),
        )
        offset.setFromSpherical(spherical).add(controls.target)
        if (offset.distanceToSquared(controls.object.position) < EPS) return
        controls.dispatchEvent({type: 'start'})
        controls.object.position.copy(offset)
        controls.update()
        controls.dispatchEvent({type: 'end'})
      },
      pan({deltaX, deltaY}) {
        const camera = controls.object
        panOffset
          .setFromMatrixColumn(camera.matrix, 0)
          .multiplyScalar(deltaX)
          .add(
            offset.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(deltaY),
          )
        if (panOffset.lengthSq() < EPS) return
        controls.dispatchEvent({type: 'start'})
        camera.position.add(panOffset)
        controls.target.add(panOffset)
        controls.update()
        controls.dispatchEvent({type: 'end'})
      },
      dolly({delta}) {
        offset.copy(controls.object.position).sub(controls.target)
        const length = offset.length()
        // 正值 = 靠近瞄准点;不小于轨道最小距离(兜底 0.01 防与瞄准点重合)
        const next = Math.max(controls.minDistance || 0.01, length - delta)
        if (Math.abs(next - length) < EPS) return
        controls.dispatchEvent({type: 'start'})
        controls.object.position.copy(
          offset.setLength(next).add(controls.target),
        )
        controls.update()
        controls.dispatchEvent({type: 'end'})
      },
      reset() {
        const camera = controls.object
        const atRest =
          camera.position.distanceToSquared(
            homeCamera.set(...DIRECTOR_HOME_CAMERA_POSITION),
          ) < EPS &&
          controls.target.distanceToSquared(
            offset.set(...DIRECTOR_HOME_TARGET_POSITION),
          ) < EPS
        if (atRest) return
        controls.dispatchEvent({type: 'start'})
        camera.position.set(...DIRECTOR_HOME_CAMERA_POSITION)
        controls.target.set(...DIRECTOR_HOME_TARGET_POSITION)
        controls.update()
        controls.dispatchEvent({type: 'end'})
      },
    }
    return registerDirectorView(controller)
  }, [controls])

  return (
    <OrbitControls
      ref={setControls}
      makeDefault // 让 GizmoHelper 能读到 controls.target 并在吸附动画后复位 camera.up
      enabled={enabled}
      enableDamping={false}
      zoomSpeed={0.5} // 默认 1 每步缩放 5%,调低一档,滚轮/捏合/Ctrl+中键共用
      // 平移方向对齐 Blender("视角跟着鼠标走"),与 OrbitControls 默认相反;
      // panSpeed 取负即方向反转、速度不变,Shift+中键拖动走这里
      panSpeed={-1}
      // 旋转同理取反对齐 Blender;触控板 wheel 旋转的公式里直接引用
      // controls.rotateSpeed,两条路径一起翻
      rotateSpeed={-1}
      mouseButtons={{
        LEFT: -1 as MOUSE, // 左键留给点选,不驱动视角
        MIDDLE: MOUSE.ROTATE, // 中键旋转(Shift+中键平移由内置修饰键逻辑提供)
        RIGHT: -1 as MOUSE, // 右键不驱动视角
      }}
    />
  )
}

/**
 * 视图右上角的方向轴部件(Blender 的导航 gizmo):点击轴头把视角吸附到
 * 对应的正/反轴向视图(前/后/左/右/顶/底),XYZ 对应红绿蓝。
 * 吸附是 GizmoHelper 内部逐帧的补间动画,onUpdate 每帧触发:首帧开 scrub、
 * 逐帧 capture、动画停 200ms 后 commit,整个吸附合成一步可撤销记录。
 * 相机的朝向不用写回——PerspectiveCamera 每帧 lookAt Target,位置对了朝向就对。
 */
function GizmoNav({
  cameraObjRef,
}: {
  cameraObjRef: React.MutableRefObject<ISheetObject<any> | undefined>
}) {
  const camera = useThree((s) => s.camera)
  const scrubRef = useRef<IScrub | undefined>(undefined)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const onUpdate = useCallback(() => {
    const studio = getStudioSync()
    const cameraObj = cameraObjRef.current
    if (!studio || !cameraObj) return
    if (!scrubRef.current) scrubRef.current = studio.scrub()
    const p = camera.position
    try {
      scrubRef.current.capture(({set}) => {
        set(cameraObj.props.position, {x: p.x, y: p.y, z: p.z})
      })
    } catch (err) {
      // capture 抛错后 scrub 已被标记为 Discarded(不可再用)。扔掉引用,
      // 否则吸附动画剩余每一帧都会重复抛错
      console.warn('[camera] gizmo scrub 失效,本次吸附的剩余改动被放弃', err)
      scrubRef.current = undefined
      return
    }
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => {
      const s = scrubRef.current
      scrubRef.current = undefined
      try {
        // 导航轴吸附同属编辑器视角:持久化,但不进撤销历史
        s?.commit(false)
      } catch (err) {
        // scrub 已失效时 commit 会抛错,不能让它阻止引用清理
        console.warn('[camera] gizmo scrub 提交失败', err)
      }
    }, 200)
  }, [camera, cameraObjRef])

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    },
    [],
  )

  return (
    // 右上角往左让出属性面板的位置,避免轴臂被面板遮住。
    // key=相机:默认相机切换(或热更新后状态老化)时强制 gizmo 重建,
    // 防止它内部缓存了旧相机导致朝向冻结
    <GizmoHelper
      key={camera.uuid}
      alignment="top-right"
      margin={[340, 70]}
      onUpdate={onUpdate}
    >
      <GizmoViewport labelColor="white" />
    </GizmoHelper>
  )
}

// 每台相机一个 camera objRef(多相机:单对 ref 会被 map 里的实例互相覆盖)。
// 普通对象即可,不进 React 渲染——可放 Map 里按 key 取
type ShotObjRefs = {
  camera: MutableRefObject<ISheetObject<any> | undefined>
}

/**
 * 删除路径前收集绑定它的相机(连同机位定格),交给注册表折进清单移除的
 * 同一个 scrub 里回退——为什么不靠 ShotCamera 的失效看护做本地删除的回退,
 * 见 removePathFromRegistry 的注释(撤销陷阱)。
 * 机位采样行进进度处 = 相机画面里的当前位置(进度共享在路径对象上,
 * 一台采样全体通用);没点的路径没驱动过相机,不定格。
 * 清单现场重读,不用渲染期快照(对齐启动自检的教训:快照有瞬窗)。
 */
function collectBoundCameraResets(
  sheet: ISheet,
  shotRefs: Map<string, ShotObjRefs>,
  metaKey: string,
): BoundCameraReset[] {
  const registeredKeys = readPathEntries(getPathsRegistry(sheet)).map(
    (e) => e.pathKey,
  )
  let freeze: {x: number; y: number; z: number} | null = null
  if (pathExists(sheet, metaKey) && readPathPoints(sheet, metaKey).length > 0) {
    const meta = getPathMeta(sheet, metaKey)
    const tmp = new Vector3()
    if (samplePathPoint(metaKey, val(meta.props.progress) as number, tmp)) {
      freeze = {x: tmp.x, y: tmp.y, z: tmp.z}
    }
  }
  const resets: BoundCameraReset[] = []
  for (const entry of readCameraEntries(getCamerasRegistry(sheet))) {
    const obj = shotRefs.get(entry.cameraKey)?.camera.current
    if (!obj) continue
    const pathKey = (val(obj.props.pathKey) as string | undefined) ?? ''
    if (resolveBoundPathKey(pathKey, registeredKeys) !== metaKey) continue
    resets.push({obj, freeze})
  }
  return resets
}

/**
 * 中性环境光贴图(RoomEnvironment):GLB 模型是 PBR 材质,只靠点光源/平行光
 * 会发闷发暗,环境贴图才是 PBR 的主要亮度来源。内置程序生成的房间环境,
 * 不拉外部 HDR,离线可用;强度压低,只负责"打亮",明暗关系仍归 Key Light。
 */
function EnvLighting() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.6
    return () => {
      scene.environment = null
      scene.environmentIntensity = 1
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/**
 * 背景色(Blender 4.x 默认视口色 #454545)。
 * 注意:Canvas 是 linear 模式,scene.background 的 Color 会被原样写进
 * gl.clearColor 不做 sRGB 编码,而 hex 构造时又已按 sRGB→linear 转换
 * 过一次,直接写 hex 会暗两个数量级(看上去纯黑)。这里按 linear 原值
 * 构造,让屏幕显示值 = 目标 sRGB 值。材质颜色不受影响(走着色器输出链)。
 */
const BACKGROUND = new Color().setRGB(
  0x45 / 255,
  0x45 / 255,
  0x45 / 255,
  LinearSRGBColorSpace,
)

/**
 * Blender 式地面网格:布局参考线,编辑辅助对象(登记 editorOnly,
 * 画中画/镜头视角取景不画它)。微抬 0.01 避免与放置面 z-fighting;
 * 不参与射线检测,不挡点选/放置。
 * 颜色注意:linear 模式下材质色同样被压暗 ^2.2,hex 要按目标显示色
 * 反推(目标 #55555b → hex #9b9ba1)。
 */
function GroundGrid() {
  const ref = useRef<Mesh>(null!)
  useEffect(() => registerEditorOnly(ref.current), [])
  // 场景单位 = 米:小格 1 米、粗线 5 米
  return (
    <Grid
      ref={ref}
      position={[0, 0.01, 0]}
      args={[100, 100]}
      cellSize={1}
      cellColor="#9b9ba1"
      sectionSize={5}
      sectionColor="#aeaeb6"
      fadeDistance={80}
      fadeStrength={1}
      infiniteGrid
      raycast={() => null}
    />
  )
}

/**
 * 添加相机的默认取景种子(2026-10-17,Task 10 抽成纯函数):
 * 新机位/朝向都取当前导演视角(用户正看着的画面);无导演相机时无种子
 * (组件按 theatre 属性默认值落地)。UI 顶栏「添加相机」与 Agent
 * cameras.create(fromCurrentView) 的 Scene Runtime 绑定共用。
 */
export function captureCameraSeed(
  mainCam: ISheetObject<any> | undefined,
): CameraSeed | undefined {
  if (!mainCam) return undefined
  return {
    position: val(mainCam.props.position) as CameraSeed['position'],
    rotation: val(mainCam.props.rotation) as CameraSeed['rotation'],
  }
}

/**
 * 添加锚点的默认落点(2026-10-17,Task 10 抽成纯函数):
 * 落在当前导演视角前方约 5 单位(导演相机 -Z 前方,three 相机朝向约定);
 * 无导演相机退场景中心上方。UI 顶栏「添加锚点」与 Agent
 * anchors.create(缺省 position)的 Scene Runtime 绑定共用。
 */
export function captureAnchorSeed(
  mainCam: ISheetObject<any> | undefined,
): AnchorSeed {
  if (!mainCam) return {position: {x: 0, y: 1, z: 0}}
  const p = val(mainCam.props.position) as {x: number; y: number; z: number}
  const r = val(mainCam.props.rotation) as {x: number; y: number; z: number}
  const forward = new Vector3(0, 0, -1).applyEuler(
    new Euler(r.x, r.y, r.z, 'XYZ'),
  )
  return {
    position: {
      x: p.x + forward.x * 5,
      y: p.y + forward.y * 5,
      z: p.z + forward.z * 5,
    },
  }
}

/**
 * 相机场景组件(spec §3 宿主唯一渲染面,2026-10-12 由 App 改名而来):
 * project 由宿主经 useCameraStudio 的 sceneProps 注入(bootstrap 内解析,
 * 字符串/IProject 实例皆由配置侧处理),组件内不再 getProject。
 * UI 装配可配见 ./uiConfig:停靠框 portal 容器 / z-index 基准 / 语言
 * (宿主已包 I18nProvider 时语言以宿主为准,ui.locale 仅自包时生效)。
 */
export function CameraScene({project, onFlows, onError}: CameraSceneProps) {
  const t = useT()
  const cameraTargetRef = useRef<Mesh>(null!)
  const cameraObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const targetObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  // 场景摄像机(镜头):独立于编辑主视角,取景用于画中画/镜头视角。
  // 每台相机一对 objRef,按 cameraKey 取(单对 ref 会被多实例互相覆盖)
  const shotRefsMapRef = useRef(new Map<string, ShotObjRefs>())
  const getShotRefs = (cameraKey: string): ShotObjRefs => {
    const map = shotRefsMapRef.current
    let refs = map.get(cameraKey)
    if (!refs) {
      refs = {camera: {current: undefined}}
      map.set(cameraKey, refs)
    }
    return refs
  }
  // 每个锚点一个 objRef(多锚点:单对 ref 会被 map 里的实例互相覆盖)。
  // CameraScene 持有而非组件自持:删除后的 ref slot 清理由下面的看护
  // effect 按注册表清单扫(真删本身走 anchorsRegistry.removeAnchor,
  // forgetObject 按地址清持久数据,不再依赖这里的对象句柄)
  const anchorRefsMapRef = useRef(
    new Map<string, MutableRefObject<ISheetObject<any> | undefined>>(),
  )
  const getAnchorRef = (
    anchorKey: string,
  ): MutableRefObject<ISheetObject<any> | undefined> => {
    const map = anchorRefsMapRef.current
    let ref = map.get(anchorKey)
    if (!ref) {
      ref = {current: undefined}
      map.set(anchorKey, ref)
    }
    return ref
  }
  // true = 全屏镜头视角(导演视角让位,轨道控制器/导航块停用)
  const [shotView, setShotView] = useState(false)
  // 画中画开关(顶栏按钮):只管编辑视角右下角的小窗,不影响镜头全屏视角
  const [pipVisible, setPipVisible] = useState(true)
  // 画中画底部留白:悬在时间轴面板上方,随面板高度/收拢展开自动跟
  const pipBottom = usePipBottom()
  // 画中画边框层是 pointerEvents:none,收不到 hover——用窗口 mousemove
  // 按画中画的几何位置(与边框层/ShotCamera 同源)判定光标是否在它上面
  const [pipHovered, setPipHovered] = useState(false)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth
      const h = window.innerHeight
      const pipW = w * 0.28
      const pipH = (pipW * 9) / 16
      const left = w - 16 - pipW
      const top = h - pipBottom - pipH
      setPipHovered(
        e.clientX >= left &&
          e.clientX <= left + pipW &&
          e.clientY >= top &&
          e.clientY <= top + pipH,
      )
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [pipBottom])
  // 视频导出:进行中的导出句柄由场景导出控制器(agent/runtime/exportRuntime)
  // 同步进来(Esc 取消/相机被删中止/停止按钮共用);导出前的视角由控制器恢复
  const [exporting, setExporting] = useState(false)
  const exportHandleRef = useRef<ShotExportHandle | null>(null)

  // project 来自 props(T9):宿主经 sceneProps 注入,bootstrap 已解析
  const sheet = project.sheet('Scene')
  // 「瞄准目标」下拉的动态选项(aimTargetOptions)在 studio 面板渲染时
  // 调用,不在 React 上下文里——把当前 sheet 喂给模块级 optionsSheet,
  // 选项函数经它读 Anchors 注册表
  useEffect(() => setAimOptionsSheet(sheet), [sheet])

  const cameras = useCamerasList(sheet)
  const anchors = useAnchorsList(sheet)
  // 活动相机:画中画/镜头视角/导出只对它生效(右键「查看此镜头」= 设活动)。
  // 持久化没必要(session 态);key 失效(被删)时顺位回退清单第一台
  // (resolveActiveCamera,Task 14 抽纯函数,Agent 侧共用同一规则)
  const [activeCameraKey, setActiveCameraKey] = useState<string | null>(null)
  const activeCamera = resolveActiveCamera(cameras, activeCameraKey)

  // 相机被删(含对端同步):清掉它的 ref slot,不留失效引用
  useEffect(() => {
    const map = shotRefsMapRef.current
    for (const key of [...map.keys()]) {
      if (!cameras.some((e) => e.cameraKey === key)) map.delete(key)
    }
  }, [cameras])

  // 锚点被删(含对端同步):清掉它的 ref slot,不留失效引用
  useEffect(() => {
    const map = anchorRefsMapRef.current
    for (const key of [...map.keys()]) {
      if (!anchors.includes(key)) map.delete(key)
    }
  }, [anchors])

  const activeShotRefs = activeCamera
    ? getShotRefs(activeCamera.cameraKey)
    : undefined

  // 添加相机:取景种子由 captureCameraSeed 从当前导演视角捕获
  const addCamera = useCallback(() => {
    const entry = nextCameraEntry(sheet, cameras)
    addCameraToRegistry(sheet, entry, captureCameraSeed(cameraObjRef.current))
    // 新相机落地即活动(用户刚加的就是他想看的)
    setActiveCameraKey(entry.cameraKey)
  }, [cameras, sheet])

  // 添加锚点:落点由 captureAnchorSeed 计算(导演视角前方约 5 单位)
  const addAnchor = useCallback(() => {
    const key = nextAnchorKey(anchors)
    addAnchorToRegistry(sheet, key, captureAnchorSeed(cameraObjRef.current))
  }, [anchors, sheet])

  // 大纲右键删除走宿主注册表删除流程(与画布右键同一套真删);
  // extend 按 id 幂等覆盖,重复执行安全
  useEffect(() => {
    getStudioSync()?.extend({
      id: cameraOutlineMenuExtensionId,
      outlineObjectMenu: cameraOutlineObjectMenu,
    })
  }, [])

  // 每渲染刷新菜单上下文:注册表清单 + 删除处理器(领域删除 + 会话
  // 清理都走 afterSceneObjectDeleted 抽出的共用实现,与画布右键一致)。
  // CameraScene 不卸载;卸载时清 ctx,防止悬空 sheet 引用
  useEffect(() => {
    setCameraOutlineMenuCtx({
      sheet,
      cameras,
      anchors,
      placements: readPlacementEntries(sheet),
      paths,
      handlers: {
        removeCamera: (entry) => {
          deleteCamera(entry)
        },
        removeAnchor: (key) => {
          removeAnchor(sheet, key, collectAnchorChildResets(sheet, key))
          afterSceneObjectDeleted('anchor', key)
        },
        removePlacement: (key) => {
          deletePlacement(sheet, key)
          afterSceneObjectDeleted('model', key)
        },
        removePath: (pathKey) => {
          removePath(pathKey)
        },
      },
    })
    return () => setCameraOutlineMenuCtx(undefined)
  })

  // 无相机:镜头视角强制退出(没有镜头可看)
  useEffect(() => {
    if (!activeCamera && shotView && !exporting) setShotView(false)
  }, [activeCamera, shotView, exporting])

  // 导出锁定开录时的相机;它中途被删(本地/对端)就中止录制(丢弃)
  const exportCameraKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      exporting &&
      !cameras.some((e) => e.cameraKey === exportCameraKeyRef.current)
    ) {
      exportHandleRef.current?.abort()
    }
  }, [exporting, cameras])

  // 场景导出控制器(Task 13):活动相机校验、ShotView 切换/恢复、canvas
  // 获取、录制与异常恢复的共享核心在 agent/runtime/exportRuntime,UI 导出
  // 菜单与 Agent exports.startVideo 经它走同一流程。getter 经 ref 读最新
  // 会话态,控制器本身随 sheet 重建
  const camerasForExportRef = useRef(cameras)
  camerasForExportRef.current = cameras
  const activeCameraForExportRef = useRef(activeCamera)
  activeCameraForExportRef.current = activeCamera
  const shotViewForExportRef = useRef(shotView)
  shotViewForExportRef.current = shotView
  const exportingRef = useRef(exporting)
  exportingRef.current = exporting
  const exportController = useMemo(
    () =>
      createSceneExportController({
        sheet,
        getActiveCameraKey: () =>
          activeCameraForExportRef.current?.cameraKey ?? null,
        hasCamera: (cameraKey) =>
          camerasForExportRef.current.some((e) => e.cameraKey === cameraKey),
        setActiveCamera: (cameraKey) => setActiveCameraKey(cameraKey),
        isExporting: () => exportingRef.current,
        getShotView: () => shotViewForExportRef.current,
        setShotView,
        // 页面上只有一个 canvas(快照编辑器的在 shadow DOM 里,查不到)
        getCanvas: () => document.querySelector('canvas'),
        setExporting,
        setActiveHandle: (handle) => {
          exportHandleRef.current = handle
        },
        lockExportCamera: (cameraKey) => {
          exportCameraKeyRef.current = cameraKey
        },
      }),
    [sheet],
  )
  // 登记给 Agent exports.startVideo(getSceneExportController);卸载先
  // dispose(abort 在录任务 → 恢复视图 → 拒绝未完成任务)再解绑,
  // 防过期 cleanup 抹掉新代次登记由 register 的同一引用校验兜底
  useEffect(() => {
    const unregister = registerSceneExportController(exportController)
    return () => {
      exportController.dispose()
      unregister()
    }
  }, [exportController])

  // 运镜路径编辑模式:正在编辑的路径 metaKey(同一时刻只编辑一条,
  // 对齐 Blender 的对象/编辑模式);右键路径线或选中路径后按 Tab 进出
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const editingPathRef = useRef<string | null>(null)
  editingPathRef.current = editingPath
  // 选中的控制点(内部选中,和 studio 选区无关;控制点不是 theatre 对象)
  const [selectedPathPoint, setSelectedPathPoint] = useState<{
    metaKey: string
    key: string
  } | null>(null)
  // 右键路径线弹出的菜单:记录路径和光标位置
  const [pathMenu, setPathMenu] = useState<{
    metaKey: string
    x: number
    y: number
  } | null>(null)
  // 右键场景摄像机弹出的菜单:记录是哪台相机和光标位置
  const [cameraMenu, setCameraMenu] = useState<{
    cameraKey: string
    x: number
    y: number
  } | null>(null)
  // 右键锚点弹出的菜单:记录是哪个锚点和光标位置(Anchors 组件经
  // pg:anchor-context-menu 自定义事件透传,避免层层 props)
  const [anchorMenu, setAnchorMenu] = useState<{
    key: string
    x: number
    y: number
  } | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const {key, x, y} = (e as CustomEvent).detail
      setAnchorMenu({key, x, y})
    }
    window.addEventListener('pg:anchor-context-menu', handler)
    return () => window.removeEventListener('pg:anchor-context-menu', handler)
  }, [])
  // 调试/自动化验证挂钩:浏览器里直接读写 sheet 对象与选中态
  ;(window as any).__cameraShot = {
    cameraObjRef,
    targetObjRef,
    shotRefs: shotRefsMapRef.current,
    activeKey: () => activeCamera?.cameraKey ?? null,
  }
  // 调试挂钩(诊断撤销栈用):探 saaz 栈长度与栈顶内容,只读不改
  ;(window as any).__undoDebug = {
    stack: () => {
      const s = getStudio() as any
      const saaz = s?._store?._saaz ?? s?._saaz
      return saaz?._atom?.get?.()?.undoRedo?.stack ?? 'no saaz'
    },
    len: () => {
      const st = (window as any).__undoDebug.stack()
      return Array.isArray(st) ? st.length : st
    },
    top: () => {
      const st = (window as any).__undoDebug.stack()
      return Array.isArray(st) ? st[0] ?? null : st
    },
  }
  // 诊断期直挂 saaz 实例(惰性:render 时 studio 可能未初始化)
  ;(window as any).__saaz = () => {
    const s = getStudio() as any
    return s?._store?._saaz ?? s?._saaz ?? 'no saaz'
  }
  const {
    placing,
    pendingEntry,
    startPlacingFromLibrary,
    placeLibraryEntryAt,
    cancelPlacing,
    confirmPlacing,
    clearPending,
  } = usePlacementController(project, sheet)
  const [gizmoMode, setGizmoMode] = useGizmoMode()
  // 正在摆姿势的 placementKey(无会话为 null):Esc/双击空白/播放自动退出都靠它
  const poseSessionKey = usePoseSessionKey()
  // 资产库拆成四个独立框体,按使用需要弹出:模型/路径走顶栏按钮,
  // 姿势/动作走右键模型的菜单;框体不自动收起,各关各的
  type LibraryFrameKind = 'model' | 'pose' | 'animation' | 'path'
  const [frameOpen, setFrameOpen] = useState<Record<LibraryFrameKind, boolean>>(
    {model: false, pose: false, animation: false, path: false},
  )
  const openFrame = useCallback(
    (kind: LibraryFrameKind) => setFrameOpen((f) => ({...f, [kind]: true})),
    [],
  )
  const toggleFrame = useCallback(
    (kind: LibraryFrameKind) => setFrameOpen((f) => ({...f, [kind]: !f[kind]})),
    [],
  )
  const closeFrame = useCallback(
    (kind: LibraryFrameKind) =>
      setFrameOpen((f) => (f[kind] ? {...f, [kind]: false} : f)),
    [],
  )

  // 点击模型卡片 = 立即放到默认位(原点被占沿 +X 自动错开);要指定位置用拖拽
  const placeModelAtDefault = useCallback(
    (entry: ModelEntry) => {
      // placeLibraryEntryAt 返回 {key, persisted}(Task 8,Agent
      // models.create 的挂载等待句柄);UI 路径不等挂载完成——失败由
      // PlacedModelErrorBoundary 上告,persisted 的 rejection 已在
      // placeLibraryEntryAt 内兜底,这里只触发放置、忽略返回句柄
      placeLibraryEntryAt(entry, findFreeSpot(readPlacementPositions(sheet)))
    },
    [sheet, placeLibraryEntryAt],
  )

  // 拖拽态:模型拖拽复用 placing 幽灵(按下即进 placing,松手即 confirm);
  // 路径预设拖拽挂落点标记
  const [modelDragging, setModelDragging] = useState(false)
  const [presetDrag, setPresetDrag] = useState<PathPreset | null>(null)
  const startModelDrag = useCallback(
    (entry: ModelEntry) => {
      setModelDragging(true)
      startPlacingFromLibrary(entry).catch((err) => {
        console.warn('[placement] 库模型加载失败', err)
        setModelDragging(false)
      })
    },
    [startPlacingFromLibrary],
  )
  // 右键已放置模型弹出的操作菜单:记录目标条目和光标位置
  const [objectMenu, setObjectMenu] = useState<{
    key: string
    x: number
    y: number
  } | null>(null)

  // 菜单关闭回调:稳定的引用,避免 CanvasContextMenu 不必要的重渲染
  const closeObjectMenu = useCallback(() => setObjectMenu(null), [])
  const closePathMenu = useCallback(() => setPathMenu(null), [])
  const closeCameraMenu = useCallback(() => setCameraMenu(null), [])
  const closeAnchorMenu = useCallback(() => setAnchorMenu(null), [])

  // 对象删除后的会话清理(2026-10-19,Task 14 从各删除流程抽出共用;
  // Agent objects.delete 经 runtime handler 调同一实现):项目数据已由
  // 领域删除函数在单个事务里清完,这里只收会话态——
  // - 路径编辑态/控制点选择随被删路径清掉(失焦式退出:不回头重选,
  //   对象已经没了,重选会把它又建出来);
  // - 还指着被删对象的右键菜单关掉;
  // - 大纲伪集合(收藏/分组名单)里摘掉该对象;
  // - studio 选区里摘除被删对象(仅当它还在选区里,其余选择保留——
  //   注册表行已删但组件尚未卸载的窗口里,选区不得留着已失效对象)。
  // 活动相机回退/镜头视角强制退出/导出中止由推导与看护 effect 自动完成。
  const afterSceneObjectDeleted = useCallback(
    (kind: SceneObjectKind, key: string) => {
      const studio = getStudioSync()
      const mounted = getSceneSheetObject(formatSceneObjectId(kind, key))
      if (
        studio &&
        mounted &&
        (studio.selection as unknown[]).includes(mounted)
      ) {
        studio.setSelection(studio.selection.filter((item) => item !== mounted))
      }
      if (kind === 'path') {
        if (editingPathRef.current === key) {
          setEditingPath(null)
          setSelectedPathPoint(null)
        }
        setSelectedPathPoint((sel) => (sel?.metaKey === key ? null : sel))
      }
      setPathMenu((m) => (m?.metaKey === key ? null : m))
      setCameraMenu((m) => (m?.cameraKey === key ? null : m))
      setAnchorMenu((m) => (m?.key === key ? null : m))
      setObjectMenu((m) => (m?.key === key ? null : m))
      const {projectId, sheetId, sheetInstanceId} = sheet.address
      pruneObjectFromOutlineCollections(
        projectId,
        sheetId,
        sheetInstanceId,
        key,
      )
    },
    [sheet],
  )

  // 删除相机(右键菜单):真删——持久数据清掉、大纲行消失;
  // 活动相机被删时 activeCamera 推导自动顺位给清单第一台
  const deleteCamera = useCallback(
    (entry: CameraEntry) => {
      removeCamera(sheet, entry)
      afterSceneObjectDeleted('camera', entry.cameraKey)
    },
    [sheet, afterSceneObjectDeleted],
  )

  // 导出目标在运行环境稳定后不再变化,useMemo 避免每次渲染重建数组
  const exportSinks = useMemo(() => listSinks(), [])
  // 导出错误提示通道:有宿主 onError 走宿主,否则 alert(既有行为)
  const reportExportError = useCallback(
    (message: string) => {
      if (onError) {
        onError({source: 'export', code: 'unknown', message})
      } else {
        window.alert(message)
      }
    },
    [onError],
  )
  const handlePickExportSink = useCallback(
    (sink: ExportSink) => {
      // UI 菜单与 Agent 共用同一场景导出流程;前置校验失败(无活动相机/
      // 已在导出)同步抛,录制中途失败由控制器经 onError 透传(同既有行为)
      try {
        exportController.startVideo({sink, onError: reportExportError}).catch(
          () => {}, // 出错已通过 onError 提示,这里只吞收尾
        )
      } catch (err) {
        reportExportError(err instanceof Error ? err.message : String(err))
      }
    },
    [exportController, reportExportError],
  )
  const handleStopExport = useCallback(
    () => exportHandleRef.current?.finishEarly(),
    [],
  )

  // 跟踪 studio 选中状态,用于动作 tab 的套用与过滤
  const [selectedPlacement, setSelectedPlacement] =
    useState<ISheetObject<any> | null>(null)
  const [selectionCount, setSelectionCount] = useState(0)
  const [selectedRig, setSelectedRig] = useState<string | undefined>(undefined)
  const [rigLoading, setRigLoading] = useState(false)

  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    const sync = () => {
      const placement = studio.selection.find((item) =>
        getPlacementEntryForObject(item as ISheetObject<any>),
      ) as ISheetObject<any> | undefined
      setSelectedPlacement(placement ?? null)
      setSelectionCount(studio.selection.length)
      // 选中了 theatre 对象 → 控制点取消选中(两套手柄不同时出现)
      if (studio.selection.length > 0) setSelectedPathPoint(null)
      // 编辑中的路径失焦(选中切到了别的对象)→ 退出编辑模式,对齐
      // Blender(编辑模式跟着活动物体走);尊重用户的新选中,不回头
      // 重选路径。空选中不退:进入编辑和点选控制点时选中本就是空的
      const editing = editingPathRef.current
      if (
        editing &&
        studio.selection.length > 0 &&
        !(studio.selection as unknown[]).includes(getPathMeta(sheet, editing))
      ) {
        setEditingPath(null)
      }
    }
    sync()
    return studio.onSelectionChange(sync)
  }, [sheet])

  // 路径注册表清单:每条已注册路径一个 CameraPath + 一套面板动作
  const paths = usePathsList(sheet)

  // 进入/退出路径编辑模式(右键菜单和 Tab 共用)
  const enterPathEdit = useCallback((metaKey: string) => {
    setEditingPath(metaKey)
    // 编辑路径时清掉对象选中:对象 gizmo 和控制点 gizmo 不同时出现
    getStudioSync()?.setSelection([])
  }, [])
  const exitPathEdit = useCallback(() => {
    const editing = editingPathRef.current
    setEditingPath(null)
    setSelectedPathPoint(null)
    // 退出编辑后重新选中路径本体(对齐 Blender:Tab 出编辑模式物体保持
    // 选中),整体移动箭头随之出现
    if (editing) getStudioSync()?.setSelection([getPathMeta(sheet, editing)])
  }, [sheet])
  // 失焦式退出(点空白/选中切走):尊重现场,不回头重选路径
  const exitPathEditOnBlur = useCallback(() => {
    setEditingPath(null)
    setSelectedPathPoint(null)
  }, [])
  const isPathEditing = useCallback(() => editingPathRef.current !== null, [])

  // Tab 进出编辑模式(Blender 同款);输入框里不抢 Tab(留给焦点跳转)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      if (editingPathRef.current) {
        exitPathEdit()
      } else if (!shotView) {
        // Tab 只在选中路径时进入编辑模式(Blender:Tab 作用于选中物;
        // 没选中就什么都不做,避免凭空进入一个看不见的编辑态)
        const studio = getStudioSync()
        // 选中注册表里任意一条路径的本体 → Tab 进编辑(Blender:Tab 作用于
        // 选中物)。先探测再取句柄:getPathMeta 查不存在会顺手创建
        const selectedPath =
          studio &&
          paths.find(
            (e) =>
              pathExists(sheet, e.pathKey) &&
              (studio.selection as unknown[]).includes(
                getPathMeta(sheet, e.pathKey),
              ),
          )?.pathKey
        if (selectedPath) enterPathEdit(selectedPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, shotView, enterPathEdit, exitPathEdit, paths])

  // 切镜头视角自动退出编辑模式(路径在镜头视角本就全部隐藏)
  useEffect(() => {
    if (shotView) exitPathEdit()
  }, [shotView, exitPathEdit])

  // 调试/自动化验证挂钩:读当前编辑态、直接进出编辑模式、选中控制点
  // (点选 3D 小目标在自动化下太脆——相机一飘就点空,选中路径走这里)
  useEffect(() => {
    ;(window as any).__cameraPathEdit = {
      enter: enterPathEdit,
      exit: exitPathEdit,
      current: () => editingPathRef.current,
      selectPoint: (metaKey: string, key: string | null) =>
        setSelectedPathPoint(key ? {metaKey, key} : null),
      keyframes: () => progressKeyframesRef.current,
    }
  }, [enterPathEdit, exitPathEdit])

  // 路径预设放置:点击 = 场景中心(高度跟活动相机当前 Y,无相机跟主视角,
  // 再退回 5);拖拽 = 指针落点的完整三维(视平面/表面吸附算出,见
  // PathPresetDropRig)。先播种再登记(没点就不出现),落地即进编辑模式。
  // 每一步都是既有可撤销事务,撤销 = 清单行消失 + 点数据回滚
  const pathPresetHeight = useCallback(() => {
    const camObj = activeCamera
      ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
      : undefined
    return (
      (camObj ? (val(camObj.props.position) as {y: number}).y : undefined) ??
      (cameraObjRef.current
        ? (val(cameraObjRef.current.props.position) as {y: number}).y
        : 5)
    )
  }, [activeCamera])
  const placePresetPath = useCallback(
    (preset: PathPreset, at?: {x: number; y: number; z: number}) => {
      // 落点三维都进来:拖拽放置的高度由视平面/表面吸附决定(所见即所得),
      // 点击放置没有落点,高度退回活动相机当前 Y
      const center = {
        x: at?.x ?? 0,
        y: at?.y ?? pathPresetHeight(),
        z: at?.z ?? 0,
      }
      const entry = nextPathEntry(readPathEntries(getPathsRegistry(sheet)))
      // 注册表说 key 空着,但同名路径可能带着旧点:撤销只退登记没退播种、
      // 或同步中断的部分持久化,都会留这种孤儿(启动自检只查 legacy 的
      // "Pos Path" 一个 key;且跨会话孤儿的值在持久态里,对象表探测
      // 根本看不到)。不真删就播种,addPathPoint 会把旧点当既有路径
      // 延伸,新路径落在旧位置(中点偏差)——注册表是唯一事实源,
      // 取回对象看实际点数,有点就是孤儿,真删再播种
      if (readPathPoints(sheet, entry.pathKey).length > 0) {
        removePathFromRegistry(sheet, entry)
      }
      // 落点 = 路径原点:控制点存相对落点的局部坐标,落点本身在同一次
      // 提交里写进位置变换——原点标记/整体移动箭头锚在落点(所见即所得),
      // 世界位置与直接世界坐标播种等价
      const {points, position} = presetPlacement(preset, center)
      addPathPoint(sheet, entry.pathKey, points, (set) => {
        set(getPathMeta(sheet, entry.pathKey).props.position, position)
      })
      addPathToRegistry(sheet, entry)
      enterPathEdit(entry.pathKey)
    },
    [sheet, pathPresetHeight, enterPathEdit],
  )

  // 删除整条路径:领域函数在 agent/pathCommands(deletePathDomain,
  // 最后一点删除与 objects.delete 共用同一清理);UI 侧传入自己按 refs
  // 收集的绑定相机回退(既有行为逐行保留)。会话清理(编辑态/选中点/
  // 菜单/大纲集合/选区)走 afterSceneObjectDeleted 的共用实现
  const removePath = useCallback(
    (metaKey: string) => {
      deletePathDomain(sheet, metaKey, {
        boundCameras: collectBoundCameraResets(
          sheet,
          shotRefsMapRef.current,
          metaKey,
        ),
      })
      afterSceneObjectDeleted('path', metaKey)
    },
    [sheet, afterSceneObjectDeleted],
  )

  const deleteSelectedPathPoint = useCallback(() => {
    if (!selectedPathPoint) return
    // 删掉最后一个点 = 删除整条路径("没点就不出现")
    if (readPathPoints(sheet, selectedPathPoint.metaKey).length <= 1) {
      removePath(selectedPathPoint.metaKey)
      return
    }
    if (
      deletePathPoint(sheet, selectedPathPoint.metaKey, selectedPathPoint.key)
    ) {
      setSelectedPathPoint(null)
    }
  }, [sheet, selectedPathPoint, removePath])

  // 启动自检(只在挂载时跑一次):对象在但注册表没有 = 孤儿(老结构
  // 残留的空路径对象),真删——"没点就不出现"。legacy 只查 Pos Path 一个
  // key。用非创建式探测 pathExists + 现场重读注册表,不用渲染期快照:
  // 响应式写法会在"添加路径后对象先于注册表行出现"的瞬间误判刚加的
  // 路径为孤儿并把它删掉
  useEffect(() => {
    if (
      pathExists(sheet, POS_PATH_KEY) &&
      !readPathEntries(getPathsRegistry(sheet)).some(
        (e) => e.pathKey === POS_PATH_KEY,
      )
    ) {
      removePathFromRegistry(sheet, {pathKey: POS_PATH_KEY})
    }
  }, [sheet])
  // 路径被移除(含对端同步删除)时,它的编辑态/选中点一并清掉。
  // 判定加"对象也没了":添加路径时对象先于注册表行出现(播种在登记
  // 之前),只看清单会在那个瞬间误退刚进入的编辑态
  useEffect(() => {
    if (
      editingPath &&
      !paths.some((e) => e.pathKey === editingPath) &&
      !pathExists(sheet, editingPath)
    ) {
      exitPathEditOnBlur()
    }
  }, [sheet, editingPath, paths, exitPathEditOnBlur])

  // 正在编辑的路径对象(钉帧/关键帧列表都按它算;对象不存在为 null)
  const editingPathExists = usePathExists(sheet, editingPath ?? '')
  const editingPathMeta = useMemo(
    () =>
      editingPath && editingPathExists ? getPathMeta(sheet, editingPath) : null,
    [sheet, editingPath, editingPathExists],
  )

  // 每条路径的进度读取(进度标记用):按 key 读对应路径对象,
  // 对象不存在时报 0(共享进度:进度只在路径对象上)
  const pathProgressOf = useCallback(
    (pathKey: string) => () =>
      pathExists(sheet, pathKey)
        ? (val(getPathMeta(sheet, pathKey).props.progress) as number)
        : 0,
    [sheet],
  )

  // 绑定到活动相机:只写 pathKey(绑定的单一直径,见 pathBinding.ts);
  // 这里是无相机面板时的入口(路径右键菜单)
  const bindPathToActiveCamera = useCallback(
    (pathKey: string) => {
      const studio = getStudioSync()
      const cam = activeCamera
        ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera.current
        : undefined
      if (!studio || !cam) return
      const scrub = studio.scrub()
      scrub.capture(({set}) => {
        set(cam.props.pathKey, pathKey)
      })
      scrub.commit()
    },
    [activeCamera],
  )

  // 钉到播放头:把控制点的抵达时间变成时间轴上的标准关键帧。
  // 首钉先把路径的行进进度转成序列轨道(之后 set 写的就是播放头处的
  // 关键帧,属性面板的菱形和 theatre 默认行为一致),再在当前播放头打
  // 值=锚点的关键帧;拖关键帧 = 改抵达时间,删关键帧 = 解钉,撤销照常
  const pinPathPointAtPlayhead = useCallback(
    (u: number) => {
      const studio = getStudioSync()
      if (!studio || !editingPathMeta) return
      const hasTrack =
        typeof getDeep(
          privateAPI(editingPathMeta)
            .template.getMapOfValidSequenceTracks_forStudio()
            .getValue(),
          ['progress'],
        ) === 'string'
      if (!hasTrack) {
        studio.transaction(({sequenceProp}) =>
          sequenceProp(editingPathMeta.props.progress),
        )
      }
      const scrub = studio.scrub()
      scrub.capture(({set}) => set(editingPathMeta.props.progress, u))
      scrub.commit()
    },
    [editingPathMeta],
  )

  // 行进进度轨道的关键帧(响应式:打帧/拖帧/删帧/撤销都反映),
  // 路径浮条用它列出选中控制点钉在了哪些时间
  const progressKeyframes = usePrism(
    () =>
      editingPathMeta
        ? privateAPI(editingPathMeta)
            .sheet.getSequence()
            .getKeyframesOfSimpleProp(editingPathMeta.props.progress)
            .map((k) => ({position: k.position, value: k.value as number}))
        : [],
    [editingPathMeta],
  )
  // 调试挂钩读最新值用(上面 __cameraPathEdit 的 effect 声明在前,直引会 TDZ)
  const progressKeyframesRef = useRef(progressKeyframes)
  progressKeyframesRef.current = progressKeyframes

  // 导出开录时机:先切到镜头视角(录 canvas 当前内容),ShotView/活动
  // 相机切换生效(本副作用)后通知场景导出控制器开录;无挂起导出请求时
  // 静默 no-op。流程主体(校验/canvas/录制/恢复)在 exportRuntime
  useEffect(() => {
    if (!shotView) return
    exportController.notifySceneReady()
  }, [shotView, activeCamera, exportController])

  // 导出中按 Esc = 取消(丢弃已录内容)
  useEffect(() => {
    if (!exporting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exportHandleRef.current?.abort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exporting])

  // 镜头视角下 Esc 返回导演视角(导出中 Esc 是取消导出,见上面的导出 effect;
  // 两个 effect 不共存:导出中 exporting=true 时本 effect 不挂)
  useEffect(() => {
    if (!shotView || exporting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShotView(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shotView, exporting])

  // 窗口级撤销/重做(spec §8.3):画布焦点下 Ctrl+Z 也能撤,直达 studio 历史
  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    return bindUndoShortcuts(
      () => studio.undo(),
      () => studio.redo(),
    )
  }, [])

  // 姿势模式下 Esc/Enter 退出(提交);导出中/镜头视角的 Esc 语义优先,不抢
  useEffect(() => {
    if (!poseSessionKey || shotView || exporting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      // Enter 在交互元素(输入框/按钮/链接等)里是控件自身语义——按钮
      // Enter=click,会在保存帧之后误触按钮处理器(打帧/清除把刚存的帧
      // 覆盖或删轨);studio UI 内的事件也不触发(shadow DOM retarget,
      // e.target 失真,交给 studio 自己处理)。Esc 无文本副作用,不用守
      // (spec §8.1 终审 F3)
      if (e.key === 'Enter') {
        if (isPoseExitGuardedTarget(e.target)) return
        if (isInsideStudioUi(e)) return
      }
      requestPoseExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poseSessionKey, shotView, exporting])

  // 双击空白退出姿势模式:落在模型上的双击由模型自己处理(进入/切换);
  // 落在控制球/被摆模型上不算空白(poseHitTest);只认画布,UI 面板里的
  // 双击不退出
  useEffect(() => {
    if (!poseSessionKey) return
    const onDblClick = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      if (isModelDoubleClick(e.timeStamp)) return
      if (poseHitTest(e)) return
      requestPoseExit()
    }
    window.addEventListener('dblclick', onDblClick)
    return () => window.removeEventListener('dblclick', onDblClick)
  }, [poseSessionKey])

  // 序列开始播放 = mixer 接管骨骼,姿势模式自动提交退出
  useEffect(() => {
    return onChange(sheet.sequence.pointer.playing, (playing) => {
      if (playing && getPoseSession()) requestPoseExit()
    })
  }, [sheet])

  // 选中单个库来源模型时,异步查其 rig 给面板过滤动画
  useEffect(() => {
    let cancelled = false
    const entry = selectedPlacement
      ? getPlacementEntryForObject(selectedPlacement)
      : undefined
    if (!entry?.libraryEntryId) {
      setSelectedRig(undefined)
      setRigLoading(false)
      return
    }
    setRigLoading(true)
    const load = async () => {
      try {
        const libEntry = await getLibrary().getEntry(entry.libraryEntryId!)
        if (cancelled) return
        setSelectedRig(libEntry?.rig)
      } finally {
        if (!cancelled) setRigLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedPlacement])

  const applyAnimation = useCallback(
    (animEntry: AnimationEntry) => {
      const studio = getStudioSync()
      if (!studio || !selectedPlacement) return
      const scrub = studio.scrub()
      scrub.capture(({set}) => {
        set(selectedPlacement.props.animation, animEntry.id)
      })
      scrub.commit()
    },
    [selectedPlacement],
  )

  const applyPose = useCallback(
    (poseEntry: PoseEntry) => {
      if (!selectedPlacement) return
      // 库姿势应用(spec §6.2/§7.3):写 lib 引用。有轨道时在播放头写
      // 关键帧(引用入帧);无轨道时写静态值,不建轨道——固定姿势不
      // 意外多出轨道。旧「顺手清 poseOverride」随两字段合并消失。
      setPoseValue(selectedPlacement, serializeLibPose(poseEntry.id))
    },
    [selectedPlacement],
  )

  // 抽帧存姿势:从当前选中的已放置模型实例捕获骨骼状态入库。
  // 入库流程(rig 解析/capturePose/putEntry/缩略图)与 Agent
  // poses.saveCurrent 共用 poseMode/savePose.savePoseFromInstance;
  // 这里只负责 UI 侧的名称来源(prompt)与告警。
  const onSavePose = useCallback(async () => {
    try {
      const placement = selectedPlacement
        ? getPlacementInstanceForObject(selectedPlacement)
        : undefined
      const instance = placement?.instance
      const entry = placement?.entry
      if (!instance) return
      const poseEntries = (await getLibrary().listEntries(
        'pose',
      )) as PoseEntry[]
      const defaultName = `姿势-${poseEntries.length + 1}`
      const name = window.prompt('姿势名称', defaultName)?.trim()
      if (!name) return
      await savePoseFromInstance({
        library: getLibrary(),
        instance,
        libraryEntryId: entry?.libraryEntryId,
        name,
      })
    } catch (err) {
      console.warn('[assetLibrary] 存姿势失败', err)
    }
  }, [selectedPlacement])

  const canApplyAnimation =
    selectedPlacement !== null &&
    selectionCount === 1 &&
    getPlacementEntryForObject(selectedPlacement)?.libraryEntryId !== undefined

  const canApplyPose = canApplyAnimation

  const selectedPlacementInstance = selectedPlacement
    ? getPlacementInstanceForObject(selectedPlacement)?.instance
    : undefined
  const canSavePose =
    selectedPlacement !== null &&
    selectionCount === 1 &&
    selectedPlacementInstance !== undefined &&
    rigIdOf(selectedPlacementInstance) !== 'static'

  // 姿势状态行(spec §6.2):来源文案 + 帧数 + 打帧/清除姿势。
  // poseKeyframeCount 是命令式读取(非响应式),CameraScene 已随 selectedPoseJson
  // (useVal)与选中变化重渲,覆盖写帧/撤销/切换对象的刷新路径;轨道刚建立
  // 的那一瞬由随后的写帧值变化带动,一个渲染周期内跟上。
  const poseEntries = useLibraryEntries('pose') as PoseEntry[]
  const selectedPoseJson =
    (useVal(selectedPlacement?.props.pose) as string | undefined) ?? ''
  const poseKeyframeCount = selectedPlacement
    ? getPoseKeyframeCount(selectedPlacement)
    : 0
  // libName 反查:状态行显示库条目名,条目缺失回退 id(告警与回退由
  // resolve 层负责,这里只做文案)
  const parsedPose = parsePoseValue(selectedPoseJson)
  const poseLibName =
    parsedPose?.kind === 'lib'
      ? poseEntries.find((e) => e.id === parsedPose.id)?.name ?? null
      : null
  const poseStatus = poseStatusText(selectedPoseJson, poseLibName, t)
  const onWritePoseKeyframe = useCallback(() => {
    if (selectedPlacement)
      writePoseKeyframe(selectedPlacement, selectedPoseJson)
  }, [selectedPlacement, selectedPoseJson])
  const onClearPose = useCallback(() => {
    if (!selectedPlacement) return
    // 单事务删轨 + 清静态(一个撤销步骤),与 Agent poses.clear 共用
    // poseTrack.clearPoseValue;空姿势是明确 no-op,不产生空撤销步
    clearPoseValue(selectedPlacement)
  }, [selectedPlacement])

  // ── 宿主能力句柄(规格:host-picker-integration)────────────
  // 纯转发既有函数;宿主注入自己的选择框后,经 onFlows 拿到句柄,
  // 在选择框里调 startPlacingModel(点选)/ placeModelAt + dropPointFromClient(拖拽)。
  // 必须放在 return 之前:placePresetPath 等在组件体内更靠前定义,
  // 放解构处会触发暂时性死区。
  // latest-ref:规格要求句柄整个场景生命周期稳定、一次性交付。deps 直接
  // 进 useMemo 依赖链时,activeCamera 切换会经 pathPresetHeight →
  // placePresetPath 级联重建 flows、重发 onFlows;改成 ref 每次渲染刷新、
  // 句柄方法调用时才取最新 deps,useMemo([]) 只组装一次,无陈旧闭包。
  const hostFlowDepsRef = useRef<HostFlowDeps | null>(null)
  hostFlowDepsRef.current = {
    startPlacingFromLibrary,
    placeLibraryEntryAt,
    placePresetPath,
    addCamera,
    addAnchor,
    cancelPlacing,
    importModel: importModelFile,
  }
  const flows = useMemo(
    () => createHostFlows(() => hostFlowDepsRef.current!),
    [],
  )

  // ── Agent Scene Runtime 绑定(2026-10-19,Task 15)──────────────
  // 与 HostFlowsWiring 同一 effect 生命周期:挂载即把完整 handler 集绑进
  // 当前执行代次并 markReady(api.ready 随之兑现);卸载解绑并使该代次
  // 就绪失效(API_NOT_READY 换代,重挂由绑定层产出新代次;会话拆解才
  // API_DISPOSED)。无会话(直连宿主未走 bootstrap)时绑定层静默降级。
  // deps 走 latest-ref(同 hostFlowDepsRef:绑定一次、永远读最新实现,
  // activeCamera 切换等重渲染不重建绑定,无陈旧闭包)。
  const agentDepsRef = useRef<{
    cameras: CameraEntry[]
    anchors: string[]
    activeCameraKey: string | null
    shotView: boolean
    pipVisible: boolean
    gizmoMode: GizmoMode
    selectedPathPoint: {metaKey: string; key: string} | null
    placeLibraryEntryAt: (
      entry: ModelEntry,
      point: {x: number; y: number; z: number},
    ) => {key: string; persisted: Promise<void>}
    enterPathEdit: (metaKey: string) => void
    exitPathEditOnBlur: () => void
    afterSceneObjectDeleted: (kind: SceneObjectKind, key: string) => void
  } | null>(null)
  agentDepsRef.current = {
    cameras,
    anchors,
    activeCameraKey: activeCamera?.cameraKey ?? null,
    shotView,
    pipVisible,
    gizmoMode,
    selectedPathPoint,
    placeLibraryEntryAt,
    enterPathEdit,
    exitPathEditOnBlur,
    afterSceneObjectDeleted,
  }
  useEffect(() => {
    const deps = () => agentDepsRef.current!
    const handlers: AgentSceneRuntimeHandlers = {
      // 模型:转发 placeLibraryEntryAt(Task 8 已返回 {key, persisted},
      // 与 UI 点击放置同一条落地管线)
      createModel: ({entry, position}) =>
        deps().placeLibraryEntryAt(entry, position),
      // 相机:Task 15 决策——生产绑定不自动 setActiveCameraKey。
      // create/setActive 是 spec §9 的两条显式命令,Agent 调用
      // cameras.create 不得隐性改变会话态;自动激活是 UI 顶栏
      // addCamera 面向人类点击的 UX 糖,保留在 UI 包装层
      createCamera: ({seed}) => {
        const entry = nextCameraEntry(sheet, deps().cameras)
        addCameraToRegistry(
          sheet,
          entry,
          seed ?? captureCameraSeed(cameraObjRef.current),
        )
        return {key: entry.cameraKey}
      },
      setActiveCamera: ({cameraKey}) => setActiveCameraKey(cameraKey),
      createAnchor: ({position}) => {
        const key = nextAnchorKey(deps().anchors)
        addAnchorToRegistry(
          sheet,
          key,
          position ? {position} : captureAnchorSeed(cameraObjRef.current),
        )
        return {key}
      },
      // 按 key 取已挂载模型的运行时实例(poses.saveCurrent /
      // poses.session.start / animations.apply 共用)
      getModelPlacement: ({key}) => {
        const obj = getSceneSheetObject(formatSceneObjectId('model', key))
        return obj ? getPlacementInstanceForObject(obj) : undefined
      },
      openPanel: ({panel}) => openFrame(panel),
      closePanel: ({panel}) => closeFrame(panel),
      setGizmoMode: ({mode}) => setGizmoMode(mode),
      getViewState: () => ({
        activeCameraKey: deps().activeCameraKey,
        shotView: deps().shotView,
        pipVisible: deps().pipVisible,
        editingPath: editingPathRef.current,
        gizmoMode: deps().gizmoMode,
      }),
      setShotView: ({on}) => setShotView(on),
      setPipVisible: ({visible}) => setPipVisible(visible),
      startPathEditing: ({pathKey}) => deps().enterPathEdit(pathKey),
      // 失焦式退出:清编辑态,不回头重选路径本体(与 handler 声明一致)
      exitPathEditing: () => deps().exitPathEditOnBlur(),
      selectPathPoint: ({pathKey, pointKey}) =>
        setSelectedPathPoint({metaKey: pathKey, key: pointKey}),
      getPathEditingState: () => {
        const pathKey = editingPathRef.current
        const selection = deps().selectedPathPoint
        return {
          pathKey,
          pointKey:
            pathKey && selection?.metaKey === pathKey ? selection.key : null,
        }
      },
      clearPathPointSelection: () => setSelectedPathPoint(null),
      afterSceneObjectDeleted: ({kind, key}) =>
        deps().afterSceneObjectDeleted(kind, key),
    }
    return bindCameraStudioSceneHandlers(handlers)
    // sheet 随 project 固定(组件实例不换 project);deps 全部走 ref
  }, [sheet])

  useEffect(() => {
    setPlacingSnapshot(placing)
  }, [placing])
  // 顶栏库按钮:打开内置框体。宿主换框体走 pickerRegistry 注册
  // (picker-frames-registry 机制),不再经组件 props 覆盖(T9 随
  // CameraScene props 收紧为 {project, onFlows} 移除)
  const handleToggleModel = useMemo(
    () => () => toggleFrame('model'),
    [toggleFrame],
  )
  const handleTogglePath = useMemo(
    () => () => toggleFrame('path'),
    [toggleFrame],
  )
  // 稳定引用:行为不变(setPipVisible 取反),与 handleToggleModel/Path 同模式
  const handleTogglePip = useCallback(() => setPipVisible((v) => !v), [])

  // 首屏闸门(firstScreenGate 机制):创建即安装——子树 effect 先于父 effect
  // 运行,useState 初始化器(渲染期)是子树 effect 能拿到闸门的最早时机;
  // 卸载时若单值仍是本闸门则复位(重挂载由新实例重装)
  const [firstScreenReady, setFirstScreenReady] = useState(false)
  const [coverGone, setCoverGone] = useState(false)
  const [firstScreenGate] = useState(() => {
    const gate = createFirstScreenGate(() => setFirstScreenReady(true))
    gate.expect(SCENE_MODEL_GATE_KEY)
    installFirstScreenGate(gate)
    return gate
  })
  useEffect(() => {
    return () => {
      if (getFirstScreenGate() === firstScreenGate) resetFirstScreenGate()
    }
  }, [firstScreenGate])
  // 遮罩淡出(0.3s)+ 余量后卸载,不依赖 transitionend 单一路径
  useEffect(() => {
    if (!firstScreenReady) return
    const t = setTimeout(() => setCoverGone(true), 600)
    return () => clearTimeout(t)
  }, [firstScreenReady])

  return (
    <SceneI18nRoot>
      <div
        style={{
          height: '100vh',
          position: 'relative',
        }}
      >
        <HostFlowsWiring flows={flows} onFlows={onFlows} />
        <TopToolbar
          gizmoMode={gizmoMode}
          onSelectGizmoMode={setGizmoMode}
          onToggleModelLibrary={handleToggleModel}
          onTogglePathLibrary={handleTogglePath}
          onAddCamera={addCamera}
          onAddAnchor={addAnchor}
          exportSinks={exportSinks}
          exporting={exporting}
          onPickExportSink={handlePickExportSink}
          onStopExport={handleStopExport}
          exportDisabled={!activeCamera}
          pipVisible={pipVisible}
          onTogglePip={handleTogglePip}
          pipDisabled={!activeCamera}
          libraryDisabled={!!placing || modelDragging || presetDrag !== null}
        />
        {!shotView && activeCamera && pipVisible && (
          <div
            style={{
              // 画中画边框:与 ShotCamera 渲染的右下角小窗同位置同尺寸
              position: 'absolute',
              right: 16,
              bottom: pipBottom,
              width: '28%',
              aspectRatio: '16 / 9',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 2,
              background: 'rgba(24,24,28,0.4)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            {/* 左上角:相机选择器(hover 到画中画才显示,点选 = 设为活动相机) */}
            <PipCameraSelector
              cameras={cameras}
              activeKey={activeCamera.cameraKey}
              onSelect={setActiveCameraKey}
              visible={pipHovered}
            />
          </div>
        )}
        {(modelDragging || presetDrag) && (
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              padding: '6px 12px',
              borderRadius: 6,
              background: 'rgba(24,24,28,0.9)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#eee',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            松开鼠标落点,Esc/右键取消
          </div>
        )}
        {shotView && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.55)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 10,
            }}
          >
            镜头视角 · Esc 返回导演视角
          </div>
        )}
        {frameOpen.model && (
          <ModelPickerSlot
            onPlaceModel={placeModelAtDefault}
            onDragStartModel={startModelDrag}
            disabled={rigLoading}
            onClose={() => closeFrame('model')}
          />
        )}
        {frameOpen.path && (
          <AssetLibraryPanel
            kind="path"
            onPlacePreset={(preset: PathPreset) => placePresetPath(preset)}
            onDragStartPreset={(preset: PathPreset) => setPresetDrag(preset)}
            onClose={() => closeFrame('path')}
          />
        )}
        {frameOpen.pose && (
          <AssetLibraryPanel
            kind="pose"
            onApplyPose={applyPose}
            onSavePose={onSavePose}
            canSavePose={canSavePose}
            applyDisabled={!canApplyPose}
            disabled={rigLoading}
            filterRig={selectedRig}
            poseStatus={poseStatus}
            poseKeyframeCount={poseKeyframeCount}
            onWritePoseKeyframe={onWritePoseKeyframe}
            onClearPose={onClearPose}
            onClose={() => closeFrame('pose')}
          />
        )}
        {frameOpen.animation && (
          <AssetLibraryPanel
            kind="animation"
            onApplyAnimation={applyAnimation}
            applyDisabled={!canApplyAnimation}
            disabled={rigLoading}
            filterRig={selectedRig}
            onClose={() => closeFrame('animation')}
          />
        )}
        {objectMenu && (
          <CanvasContextMenu
            position={{x: objectMenu.x, y: objectMenu.y}}
            items={buildObjectMenuItems(
              {
                mode: gizmoMode,
                onSelectMode: setGizmoMode,
                onDelete: () => {
                  deletePlacement(sheet, objectMenu.key)
                  afterSceneObjectDeleted('model', objectMenu.key)
                },
                // 库来源模型才有姿势/动作可套(本地遗留放置体没有库 id);
                // 骨架不匹配的置灰由框体自己兜
                ...(readPlacementEntries(sheet).find(
                  (e) => e.key === objectMenu.key,
                )?.libraryEntryId !== undefined
                  ? {
                      onChangePose: () => openFrame('pose'),
                      onPlayAnimation: () => openFrame('animation'),
                    }
                  : {}),
                // 摆姿势:有骨骼就显示;映射不出人形关键骨的置灰带原因
                // (独立于 libraryEntryId:本地人形模型也能摆)
                ...(() => {
                  const inst = selectedPlacement
                    ? getPlacementInstanceForObject(selectedPlacement)
                    : undefined
                  const entry = selectedPlacement
                    ? getPlacementEntryForObject(selectedPlacement)
                    : undefined
                  if (!inst || !entry || entry.key !== objectMenu.key) return {}
                  if (collectBoneNames(inst.instance).length === 0) return {}
                  const supported = resolveControlSpec(inst.instance) !== null
                  return {
                    onPoseMode: () => enterPoseSession(objectMenu.key),
                    poseModeEnabled: supported,
                    poseModeHint: t('pg.menu.poseModeUnsupported'),
                    // 清除姿势(删轨道+回 T 姿势):有骨骼的模型都可能有
                    // 姿势值/轨道;对无姿势者点击=空事务,saaz 不入栈
                    onClearPose,
                  }
                })(),
              },
              t,
            )}
            onClose={closeObjectMenu}
          />
        )}
        {pathMenu && (
          <CanvasContextMenu
            position={{x: pathMenu.x, y: pathMenu.y}}
            items={buildPathMenuItems(
              {
                metaKey: pathMenu.metaKey,
                editing: editingPath === pathMenu.metaKey,
                onToggleEdit: () => {
                  if (editingPath === pathMenu.metaKey) {
                    exitPathEdit()
                  } else {
                    enterPathEdit(pathMenu.metaKey)
                  }
                },
                // 有活动相机且它没绑这条时才出「绑定到活动相机」
                onBindToActiveCamera: (() => {
                  const cam = activeCamera
                    ? shotRefsMapRef.current.get(activeCamera.cameraKey)?.camera
                        .current
                    : undefined
                  if (!cam) return undefined
                  if (val(cam.props.pathKey) === pathMenu.metaKey)
                    return undefined
                  return () => bindPathToActiveCamera(pathMenu.metaKey)
                })(),
                onDelete: () => removePath(pathMenu.metaKey),
              },
              t,
            )}
            onClose={closePathMenu}
          />
        )}
        {cameraMenu && (
          <CanvasContextMenu
            position={cameraMenu}
            items={buildCameraMenuItems(
              {
                // 查看此镜头 = 设为活动 + 进镜头视角
                onViewShot: () => {
                  setActiveCameraKey(cameraMenu.cameraKey)
                  setShotView(true)
                },
                onDeleteCamera: () => {
                  const entry = cameras.find(
                    (e) => e.cameraKey === cameraMenu.cameraKey,
                  )
                  if (entry) deleteCamera(entry)
                },
              },
              t,
            )}
            onClose={closeCameraMenu}
          />
        )}
        {anchorMenu && (
          <CanvasContextMenu
            position={{x: anchorMenu.x, y: anchorMenu.y}}
            items={buildAnchorMenuItems({
              onDeleteAnchor: () => {
                // 真删:forgetObject 按地址清持久数据(静态覆盖/时间轴
                // 轨道,不要求挂载句柄)+ 子锚点解绑定格折进同一事务;
                // 会话清理走共用实现
                removeAnchor(
                  sheet,
                  anchorMenu.key,
                  collectAnchorChildResets(sheet, anchorMenu.key),
                )
                afterSceneObjectDeleted('anchor', anchorMenu.key)
              },
            })}
            onClose={closeAnchorMenu}
          />
        )}
        {editingPath && !shotView && (
          <PathEditBar
            hasSelection={
              !!selectedPathPoint && selectedPathPoint.metaKey === editingPath
            }
            onAddPoint={() => {
              if (editingPath) addPathPoint(sheet, editingPath, undefined)
            }}
            onDeleteSelected={deleteSelectedPathPoint}
          />
        )}
        {editingPath &&
          selectedPathPoint &&
          selectedPathPoint.metaKey === editingPath &&
          !shotView && (
            <PathPointEditor
              sheet={sheet}
              metaKey={editingPath}
              pointKey={selectedPathPoint.key}
              onPinAtPlayhead={pinPathPointAtPlayhead}
              progressKeyframes={progressKeyframes}
            />
          )}
        <Canvas
          dpr={[1.5, 2]}
          linear
          shadows="percentage"
          gl={{preserveDrawingBuffer: true}}
          frameloop="demand"
          // 点到空处取消选中,gizmo 随之消失;放置模式下点空处是确认落点,不动选中
          onPointerMissed={() => {
            if (!placing && !getPoseSession()) getStudioSync()?.setSelection([])
            // 控制点也取消选中,但路径编辑模式保持(编辑态是"粘"的)
            setSelectedPathPoint(null)
          }}
        >
          <SheetProvider sheet={sheet}>
            <HostFlowsDropPointCapture />
            <MainOrbitControls
              targetRef={cameraTargetRef}
              cameraObjRef={cameraObjRef}
              targetObjRef={targetObjRef}
              enabled={!shotView}
            />
            {!shotView && <GizmoNav cameraObjRef={cameraObjRef} />}
            <ExitPathEditOnEmptyClick
              isEditing={isPathEditing}
              onExit={exitPathEditOnBlur}
            />
            {cameras.map((entry) => (
              <ShotCamera
                key={entry.cameraKey}
                cameraKey={entry.cameraKey}
                isActive={entry.cameraKey === activeCamera?.cameraKey}
                shotView={shotView}
                pipVisible={pipVisible}
                pipBottom={pipBottom}
                cameraObjRef={getShotRefs(entry.cameraKey).camera}
                onCameraContextMenu={(x, y) =>
                  setCameraMenu({cameraKey: entry.cameraKey, x, y})
                }
              />
            ))}
            <Anchors
              sheet={sheet}
              shotView={shotView}
              getAnchorRef={getAnchorRef}
            />
            {paths.map((entry) => (
              <CameraPath
                key={entry.pathKey}
                metaKey={entry.pathKey}
                // 普通态亮紫(与预设卡片的动画轨迹同色);选中/编辑的黄色档位在 CameraPath 内部
                color={0xa78bfa}
                hidden={shotView}
                editing={editingPath === entry.pathKey}
                selectedKey={
                  selectedPathPoint?.metaKey === entry.pathKey
                    ? selectedPathPoint.key
                    : null
                }
                onSelectPoint={(key) =>
                  setSelectedPathPoint(
                    key ? {metaKey: entry.pathKey, key} : null,
                  )
                }
                onContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
                progressOf={pathProgressOf(entry.pathKey)}
              />
            ))}
            {/* 背景:Blender 4.x 默认视口背景色(linear 原值构造,见 BACKGROUND) */}
            <primitive object={BACKGROUND} attach="background" />
            {/* 布光定位=布局演示:半球光兜底(任何机位不死黑)+ 一盏主光给
              明暗面和投影(形态可读);灯固定在世界坐标、不跟相机走,
              编辑预览和录制成片一致。主光可编辑,角度在 studio 里调 */}
            <ambientLight intensity={0.3} />
            <hemisphereLight args={['#ffffff', '#444444', 1.1]} />
            <EnvLighting />
            <e.directionalLight
              theatreKey="Key Light"
              castShadow
              intensity={1.4}
              position={[10, 20, 10]}
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0001}
              shadow-camera-left={-30}
              shadow-camera-right={30}
              shadow-camera-top={30}
              shadow-camera-bottom={-30}
              shadow-camera-far={80}
            />
            <PerspectiveCamera
              theatreKey="Camera / Camera"
              objRef={cameraObjRef}
              hideFromOutline
              makeDefault={!shotView}
              position={DIRECTOR_HOME_CAMERA_POSITION}
              fov={75}
              lookAt={cameraTargetRef}
            />
            <e.mesh
              ref={cameraTargetRef}
              theatreKey="Camera / Target"
              objRef={targetObjRef}
              hideFromOutline
              position={DIRECTOR_HOME_TARGET_POSITION}
              visible="editor"
            >
              <boxGeometry attach="geometry" />
              <meshPhongMaterial attach="material" color="red" />
            </e.mesh>
            <Suspense fallback={null}>
              <InitialLoadProbe gateKey={SCENE_MODEL_GATE_KEY}>
                <Model url={sceneGLB} selectLocked={!!placing} />
              </InitialLoadProbe>
            </Suspense>
            {placing && (
              <Suspense fallback={null}>
                <PlacementRigErrorBoundary
                  onCancel={() => {
                    cancelPlacing()
                    setModelDragging(false)
                  }}
                >
                  <PlacementRig
                    placing={placing}
                    confirmOnPointerUp={modelDragging}
                    onConfirm={(p) => {
                      confirmPlacing(p)
                      setModelDragging(false)
                    }}
                    onCancel={() => {
                      cancelPlacing()
                      setModelDragging(false)
                    }}
                  />
                </PlacementRigErrorBoundary>
              </Suspense>
            )}
            <PlacedModels
              sheet={sheet}
              project={project}
              pendingEntry={pendingEntry}
              onPersisted={clearPending}
              selectLocked={!!placing}
              onObjectMenu={(key, x, y) => setObjectMenu({key, x, y})}
            />
            <SelectionGizmo hidden={!!placing || shotView} mode={gizmoMode} />
            {presetDrag && (
              <PathPresetDropRig
                heightY={pathPresetHeight()}
                onConfirm={(p) => {
                  placePresetPath(presetDrag, p)
                  setPresetDrag(null)
                }}
                onCancel={() => setPresetDrag(null)}
              />
            )}
            <GroundGrid />
          </SheetProvider>
        </Canvas>
        {/* 首屏遮罩(firstScreenGate 机制):工程就绪 + 首批模型落定前盖住
          全场,避免顶栏/轴向控制器等同步部件先蹦出来的参差开场;落定后
          淡出卸载,之后不再遮盖(后续放置走各自的加载态) */}
        {!coverGone && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: getUiConfig().zIndexBase + 100,
              background: '#454545',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: firstScreenReady ? 0 : 1,
              transition: 'opacity 0.3s ease',
              pointerEvents: firstScreenReady ? 'none' : 'auto',
            }}
          >
            <style>{`@keyframes cameraStudioFirstScreenSpin{to{transform:rotate(360deg)}}`}</style>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.25)',
                borderTopColor: '#ffffff',
                animation: 'cameraStudioFirstScreenSpin 0.8s linear infinite',
              }}
            />
          </div>
        )}
      </div>
    </SceneI18nRoot>
  )
}

/**
 * i18n 嵌套判定(spec §7):宿主树已包 studio 的 I18nProvider →
 * 原样渲染,语言以宿主为准(ui.locale 不生效);否则自包一层,
 * ui.locale 仅在这个自包分支生效(经 setLanguage 应用到 studio
 * i18n 单例——t/translate 读本单例,子树级隔离无从谈起,自包场景
 * = 无宿主 i18n 的独立挂载,全局应用即预期行为)。
 * 抽出成组件便于脱离整树做单测(HostFlowsWiring 先例)。
 */
export function SceneI18nRoot({children}: {children: React.ReactNode}) {
  const hostI18n = useContext(I18nContext)
  if (hostI18n) return <>{children}</>
  return <SceneI18n>{children}</SceneI18n>
}

/** 自包分支:I18nProvider 订阅 studio 单例语言变化;locale 一次性应用 */
function SceneI18n({children}: {children: React.ReactNode}) {
  const locale = getUiConfig().locale
  useEffect(() => {
    if (!locale) return
    setLanguage(locale)
  }, [locale])
  return <I18nProvider>{children}</I18nProvider>
}

/**
 * 路径编辑模式下点到真空 = 路径失焦,退出编辑模式(和"选中切到别的
 * 对象"同一条失焦规则,对齐 Blender 编辑模式跟活动物体走)。
 * 不挂在 Canvas 的 onPointerMissed 上:r3f 的"未命中"判定在递归命中
 * 和交互集合上和我们想要的不完全是一回事,自己监听画布 click、自己做
 * 一次射线检查,命中对象沿父链找得到事件处理器就不算空点。
 * 拖过的点击(转视角/gizmo/拖手柄)不算;gizmo 点按有屏蔽窗口兜底。
 */
function ExitPathEditOnEmptyClick({
  isEditing,
  onExit,
}: {
  isEditing: () => boolean
  onExit: () => void
}) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    let downAt: [number, number] | null = null
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY]
    }
    const onClick = (e: MouseEvent) => {
      if (!isEditing()) return
      if (isSelectSuppressed()) return
      // 按下和抬起位置差太多 = 拖拽收尾,不是点
      if (
        downAt &&
        Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4
      )
        return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      for (const h of hits) {
        let o: Object3D | null = h.object
        while (o) {
          const handlers = (o as any).__r3f?.handlers
          if (handlers && Object.keys(handlers).length > 0) return
          o = o.parent
        }
      }
      onExit()
    }
    window.addEventListener('pointerdown', onDown, true)
    gl.domElement.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      gl.domElement.removeEventListener('click', onClick)
    }
  }, [gl, camera, scene, isEditing, onExit])
  return null
}

/**
 * 宿主拖拽落点的上下文捕获:把 gl/camera 塞进 hostFlows 模块,
 * 宿主 dropPointFromClient 闭包读取。挂 Canvas 子树,卸载即清。
 */
function HostFlowsDropPointCapture() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    setDropPointContext({gl, camera})
    return () => setDropPointContext(null)
  }, [gl, camera])
  return null
}

/** 句柄交付/清理独立成组件,便于脱离整树做单测。 */
export function HostFlowsWiring({
  flows,
  onFlows,
}: {
  flows: CameraFlows
  onFlows?: (f: CameraFlows) => void
}) {
  useEffect(() => {
    setHostFlowsHandle(flows)
    onFlows?.(flows)
    return () => setHostFlowsHandle(null)
  }, [flows, onFlows])
  return null
}
