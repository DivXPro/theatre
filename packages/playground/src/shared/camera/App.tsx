import {
  editable as e,
  RefreshSnapshot,
  SheetProvider,
  PerspectiveCamera,
} from '@dreamerbird/r3f'
import {
  Stars,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei'
import {getProject, getStudioSync, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import getDeep from '@dreamerbird/utils/getDeep'
import {usePrism} from '@dreamerbird/react'
import type {IScrub, ISheetObject} from '@dreamerbird/core'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {Canvas, useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import sceneGLB from './scene.glb'
import {MOUSE, Raycaster, Spherical, Vector2, Vector3} from 'three'
import type {Mesh, Object3D} from 'three'
import {
  GizmoModeHint,
  PlacementRig,
  PlacementRigErrorBoundary,
  PlacedModels,
  SelectionGizmo,
  deletePlacement,
  getPlacementEntryForObject,
  getPlacementInstanceForObject,
  isSelectSuppressed,
  useGizmoMode,
  usePlacementController,
  usePlacementSurface,
  useSelectionGizmoTarget,
} from './PlacementManager'
import {CanvasContextMenu} from './contextMenu'
import {
  buildCameraMenuItems,
  buildObjectMenuItems,
  buildPathMenuItems,
  buildPathPanelActions,
} from './menuModel'
import {TopToolbar} from './TopToolbar'
import {AssetLibraryPanel} from './assetLibrary/AssetLibraryPanel'
import {getLibrary} from './assetLibrary/library'
import {ShotCamera} from './ShotCamera'
import {
  addCameraToRegistry,
  nextCameraEntry,
  removeCamera,
  useCamerasList,
} from './cameraRegistry'
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
  setPathPanelActions,
  translatePath,
  usePathExists,
  usePathHasPoints,
} from './CameraPath'
import {
  addPathToRegistry,
  nextPathEntry,
  readPathEntries,
  getPathsRegistry,
  removePathFromRegistry,
  usePathsList,
} from './pathRegistry'
import {seedArcPoints} from './pathModel'
import {listSinks} from './videoExport/sinks'
import type {ExportSink} from './videoExport/sinks'
import {startShotExport} from './videoExport/exporter'
import type {ShotExportHandle} from './videoExport/exporter'
import type {AnimationEntry, ModelEntry, PoseEntry} from './assetLibrary/types'
import {capturePose} from './assetLibrary/pose'
import {rigIdOf} from './assetLibrary/rig'

document.body.style.backgroundColor = '#171717'

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
        theatreKey="Example Namespace / Thingy"
        objRef={thingyObjRef}
        onClick={selectThingy}
        rotation={[Math.PI / 13.5, -Math.PI / 5.8, Math.PI / 5.6]}
      >
        <e.mesh
          theatreKey="Example Namespace / Thingy / Debris 2"
          objRef={debris2ObjRef}
          ref={debris2Ref}
          receiveShadow
          castShadow
          geometry={nodes.planet002.geometry}
          material={nodes.planet002.material}
        />
        <e.mesh
          theatreKey="Example Namespace / Thingy / Debris 1"
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
        s?.commit()
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
        s?.commit()
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

function App() {
  const bgs = ['#272730', '#b7c5d1']
  const [bgIndex, setBgIndex] = useState(0)
  const bg = bgs[bgIndex]
  const cameraTargetRef = useRef<Mesh>(null!)
  const cameraObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const targetObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  // 场景摄像机(镜头):独立于编辑主视角,取景用于画中画/镜头视角
  const shotCameraObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  const shotTargetObjRef = useRef<ISheetObject<any> | undefined>(undefined)
  // true = 全屏镜头视角(导演视角让位,轨道控制器/导航块停用)
  const [shotView, setShotView] = useState(false)
  // 视频导出:进行中的导出句柄 / 导出前的视角(导完恢复)
  const [exporting, setExporting] = useState(false)
  const exportHandleRef = useRef<ShotExportHandle | null>(null)
  const prevShotViewRef = useRef(false)
  const pendingExportSinkRef = useRef<ExportSink | null>(null)

  const project = getProject('Space')
  const sheet = project.sheet('Scene')

  // 相机清单:P1 上限一台(工具条置灰控制);P2 多相机时这里改成
  // "活动相机"(右键查看此镜头 = 设为活动),refs 也要按实例分开
  const cameras = useCamerasList(sheet)
  const activeCamera = cameras.length > 0 ? cameras[0] : null

  // 添加相机:新机位/朝向/瞄准点都取当前导演视角(用户正看着的画面)
  const addCamera = useCallback(() => {
    if (cameras.length > 0) return
    const entry = nextCameraEntry(cameras)
    const mainCam = cameraObjRef.current
    const mainTarget = targetObjRef.current
    const seed =
      mainCam && mainTarget
        ? {
            position: val(mainCam.props.position),
            rotation: val(mainCam.props.rotation),
            targetPosition: val(mainTarget.props.position),
          }
        : undefined
    addCameraToRegistry(sheet, entry, seed)
  }, [cameras, sheet])

  // 删除相机(右键菜单):真删——持久数据清掉、大纲行消失、回到无相机态
  const deleteCamera = useCallback(() => {
    const entry = cameras[0]
    if (!entry) return
    removeCamera(sheet, entry, {
      camera: shotCameraObjRef.current,
      target: shotTargetObjRef.current,
    })
  }, [cameras, sheet])

  // 无相机:镜头视角强制退出(没有镜头可看)
  useEffect(() => {
    if (!activeCamera && shotView && !exporting) setShotView(false)
  }, [activeCamera, shotView, exporting])

  // 导出中途相机被删:取消录制(丢弃)
  useEffect(() => {
    if (exporting && !activeCamera) exportHandleRef.current?.abort()
  }, [exporting, activeCamera])

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
  // 右键场景摄像机弹出的菜单:记录光标位置
  const [cameraMenu, setCameraMenu] = useState<{x: number; y: number} | null>(
    null,
  )
  // 调试/自动化验证挂钩:浏览器里直接读写 sheet 对象与选中态
  ;(window as any).__cameraShot = {
    cameraObjRef,
    targetObjRef,
    shotCameraObjRef,
    shotTargetObjRef,
  }
  const {
    placing,
    pendingEntry,
    startPlacingFromLibrary,
    cancelPlacing,
    confirmPlacing,
    clearPending,
  } = usePlacementController(project)
  const [gizmoMode, setGizmoMode] = useGizmoMode()
  const [libraryOpen, setLibraryOpen] = useState(false)
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

  // 导出目标在运行环境稳定后不再变化,useMemo 避免每次渲染重建数组
  const exportSinks = useMemo(() => listSinks(), [])
  const handlePickExportSink = useCallback(
    (sink: ExportSink) => {
      prevShotViewRef.current = shotView
      pendingExportSinkRef.current = sink
      setShotView(true)
    },
    [shotView],
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
        // 路径可能不存在(注册表驱动,没点就不建)——先探测再取句柄,
        // getPathMeta 查不存在会顺手创建
        const selectedPath =
          studio &&
          pathExists(sheet, POS_PATH_KEY) &&
          (studio.selection as unknown[]).includes(
            getPathMeta(sheet, POS_PATH_KEY),
          )
            ? POS_PATH_KEY
            : undefined
        if (selectedPath) enterPathEdit(selectedPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, shotView, enterPathEdit, exitPathEdit])

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

  // 添加路径:注册表加一行并播种一段环绕弧(从当前机位),然后进编辑
  // 模式。先播种再登记——组件挂载时点已就位,路径对象不会以空名单
  // 亮过相("没点就不出现")。不自动切相机驱动(用户决策:驱动与否
  // 只在相机面板配)
  const addPosPathPoint = useCallback(() => {
    const cam = shotCameraObjRef.current
    const target = shotTargetObjRef.current
    const mainCam = cameraObjRef.current
    const mainTarget = targetObjRef.current
    const seed =
      cam && target
        ? seedArcPoints(val(cam.props.position), val(target.props.position))
        : mainCam && mainTarget
          ? seedArcPoints(
              val(mainCam.props.position),
              val(mainTarget.props.position),
            )
          : undefined
    const entry = nextPathEntry(readPathEntries(getPathsRegistry(sheet)))
    addPathPoint(sheet, entry.pathKey, seed)
    addPathToRegistry(sheet, entry)
    enterPathEdit(entry.pathKey)
  }, [sheet, enterPathEdit])

  // 缺失提示:绑定了朝向但 Target 已被删 → 工具条下方纯文字提醒;
  // 恢复动作在相机面板动作区(恢复 Target),提示条不带按钮
  const [targetMissing, setTargetMissing] = useState(false)
  useEffect(() => {
    let offCam: (() => void) | undefined
    let cancelled = false
    // Canvas 是独立的 React root,里面 editable 填 objRef 的时机不受
    // 本 root 的 effect 顺序保证——首帧可能还没填,逐帧重试到挂上为止
    const trySubscribe = () => {
      if (cancelled) return
      if (!activeCamera) {
        setTargetMissing(false)
        return
      }
      const cam = shotCameraObjRef.current
      if (!cam) {
        requestAnimationFrame(trySubscribe)
        return
      }
      const update = () =>
        setTargetMissing(
          Boolean(val(cam.props.trackTarget)) &&
            Boolean(val(cam.props.targetHidden)),
        )
      update()
      offCam = cam.onValuesChange(update)
    }
    trySubscribe()
    return () => {
      cancelled = true
      offCam?.()
    }
  }, [shotCameraObjRef, activeCamera])

  // 删除整条路径:注册表真删(forgetObject + detach + 清单移除,撤销
  // 两步完整回滚);正在编辑/选中了它的点就一并退出/清掉——用失焦式
  // 退出(不回头重选,对象已经没了,重选会把它又建出来)
  const removePath = useCallback(
    (metaKey: string) => {
      removePathFromRegistry(sheet, {pathKey: metaKey})
      if (editingPath === metaKey) exitPathEditOnBlur()
      if (selectedPathPoint?.metaKey === metaKey) setSelectedPathPoint(null)
    },
    [sheet, editingPath, selectedPathPoint, exitPathEditOnBlur],
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

  // 路径注册表:P1 上限一条(添加按钮随之置灰),清单第一项即活动路径
  const paths = usePathsList(sheet)
  // 路径对象只在注册后存在("没点就不出现"):探测不创建——
  // sheet.object 查不存在会顺手创建,那是这里要躲开的
  const posPathExists = usePathExists(sheet, POS_PATH_KEY)
  // 进度标记/打帧都读 Pos Path 对象的行进进度;对象不存在时为 null,
  // 各消费方按 null 兜底(报 0/不渲染)
  const posPathMeta = useMemo(
    () => (posPathExists ? getPathMeta(sheet, POS_PATH_KEY) : null),
    [sheet, posPathExists],
  )
  // 启动自检:对象在但注册表没有 = 孤儿(老结构残留的空路径对象),
  // 真删——"没点就不出现"。P1 只有 Pos Path 一个 key 要查
  useEffect(() => {
    if (posPathExists && !paths.some((e) => e.pathKey === POS_PATH_KEY)) {
      removePathFromRegistry(sheet, {pathKey: POS_PATH_KEY})
    }
  }, [sheet, posPathExists, paths])
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
  // 路径面板动作区:路径平移到相机(空路径不出按钮);
  // 动作配置必须 useMemo 缓存引用,重复注册同引用是幂等的
  const posPathHasPoints = usePathHasPoints(sheet, POS_PATH_KEY)
  const movePathToCamera = useCallback(() => {
    const cam = shotCameraObjRef.current
    if (!cam) return
    const tmp = new Vector3()
    if (!samplePathPoint(POS_PATH_KEY, 0, tmp)) return
    const c = val(cam.props.position)
    translatePath(sheet, POS_PATH_KEY, {
      x: c.x - tmp.x,
      y: c.y - tmp.y,
      z: c.z - tmp.z,
    })
  }, [sheet])
  const pathPanelActions = useMemo(
    () =>
      buildPathPanelActions({
        hasPoints: posPathHasPoints,
        onMovePathToCamera: movePathToCamera,
      }),
    [posPathHasPoints, movePathToCamera],
  )
  useEffect(() => {
    // setPathPanelActions 内部走 sheet.object,对象不存在会顺手创建,
    // 必须登记在案(注册表里有)才注册动作
    if (posPathExists)
      setPathPanelActions(sheet, POS_PATH_KEY, pathPanelActions)
  }, [sheet, posPathExists, pathPanelActions])
  const pathProgressOf = useCallback(
    () => (posPathMeta ? val(posPathMeta.props.progress) : 0),
    [posPathMeta],
  )

  // 钉到播放头:把控制点的抵达时间变成时间轴上的标准关键帧。
  // 首钉先把路径的行进进度转成序列轨道(之后 set 写的就是播放头处的
  // 关键帧,属性面板的菱形和 theatre 默认行为一致),再在当前播放头打
  // 值=锚点的关键帧;拖关键帧 = 改抵达时间,删关键帧 = 解钉,撤销照常
  const pinPathPointAtPlayhead = useCallback(
    (u: number) => {
      const studio = getStudioSync()
      if (!studio || !posPathMeta) return
      const hasTrack =
        typeof getDeep(
          privateAPI(posPathMeta)
            .template.getMapOfValidSequenceTracks_forStudio()
            .getValue(),
          ['progress'],
        ) === 'string'
      if (!hasTrack) {
        studio.transaction(({sequenceProp}) =>
          sequenceProp(posPathMeta.props.progress),
        )
      }
      const scrub = studio.scrub()
      scrub.capture(({set}) => set(posPathMeta.props.progress, u))
      scrub.commit()
    },
    [posPathMeta],
  )

  // 行进进度轨道的关键帧(响应式:打帧/拖帧/删帧/撤销都反映),
  // 路径浮条用它列出选中控制点钉在了哪些时间
  const progressKeyframes = usePrism(
    () =>
      posPathMeta
        ? privateAPI(posPathMeta)
            .sheet.getSequence()
            .getKeyframesOfSimpleProp(posPathMeta.props.progress)
            .map((k) => ({position: k.position, value: k.value as number}))
        : [],
    [posPathMeta],
  )
  // 调试挂钩读最新值用(上面 __cameraPathEdit 的 effect 声明在前,直引会 TDZ)
  const progressKeyframesRef = useRef(progressKeyframes)
  progressKeyframesRef.current = progressKeyframes

  // 导出视频:先切到镜头视角(录 canvas 当前内容),再开始录制;
  // "另存为"的系统对话框在菜单点击的调用栈里已经弹过,这里只剩录制
  useEffect(() => {
    const sink = pendingExportSinkRef.current
    if (!shotView || !sink) return
    pendingExportSinkRef.current = null
    // 页面上只有一个 canvas(快照编辑器的在 shadow DOM 里,查不到)
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    const handle = startShotExport({
      canvas,
      sheet,
      sink,
      onError: (message) => window.alert(message),
    })
    if (!handle) {
      setShotView(prevShotViewRef.current)
      return
    }
    exportHandleRef.current = handle
    setExporting(true)
    handle.done
      .catch(() => {}) // 出错已通过 onError 提示,这里只收尾
      .finally(() => {
        exportHandleRef.current = null
        setExporting(false)
        setShotView(prevShotViewRef.current)
      })
  }, [shotView, sheet])

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
        const libEntry = await getLibrary().backend.getEntry(
          entry.libraryEntryId!,
        )
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
      const studio = getStudioSync()
      if (!studio || !selectedPlacement) return
      const scrub = studio.scrub()
      scrub.capture(({set}) => {
        set(selectedPlacement.props.pose, poseEntry.id)
      })
      scrub.commit()
    },
    [selectedPlacement],
  )

  // 抽帧存姿势:从当前选中的已放置模型实例捕获骨骼状态入库
  const onSavePose = useCallback(async () => {
    try {
      const placement = selectedPlacement
        ? getPlacementInstanceForObject(selectedPlacement)
        : undefined
      const instance = placement?.instance
      const entry = placement?.entry
      if (!instance) return
      // GLB 导出会清洗骨骼名(如去掉 mixamorig:Hips 中的 ':'),
      // 实例侧重算的 rig 与库模型条目记录的 rig 可能不一致。
      // 优先取库模型条目的 rig,保证保存的姿势能和来源模型匹配;
      // 本地 FBX 路径或条目缺失时回退到实例计算(legacy 路径,可能与库 rig 不一致但可接受)。
      let rig: string | undefined
      if (entry?.libraryEntryId) {
        const libEntry = await getLibrary().backend.getEntry(
          entry.libraryEntryId,
        )
        if (libEntry?.kind === 'model') rig = libEntry.rig
      }
      if (!rig) rig = rigIdOf(instance)
      if (rig === 'static') return
      const poseEntries = (await getLibrary().backend.listEntries(
        'pose',
      )) as PoseEntry[]
      const defaultName = `姿势-${poseEntries.length + 1}`
      const name = window.prompt('姿势名称', defaultName)?.trim()
      if (!name) return
      const bones = capturePose(instance)
      await getLibrary().putEntry({
        id: 'lib-' + Math.random().toString(36).slice(2, 10),
        kind: 'pose',
        name,
        rig,
        bones,
        createdAt: Date.now(),
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

  return (
    <div
      onClick={() => {
        // return setBgIndex((bgIndex) => (bgIndex + 1) % bgs.length)
      }}
      style={{
        height: '100vh',
        position: 'relative',
      }}
    >
      <TopToolbar
        placing={!!placing}
        onOpenLibrary={() => setLibraryOpen((v) => !v)}
        addPathEnabled={paths.length === 0}
        onAddPath={addPosPathPoint}
        addCameraEnabled={cameras.length === 0}
        onAddCamera={addCamera}
        exportSinks={exportSinks}
        exporting={exporting}
        onPickExportSink={handlePickExportSink}
        onStopExport={handleStopExport}
        exportDisabled={!activeCamera}
      />
      {!shotView && activeCamera && (
        <div
          style={{
            // 画中画边框:与 ShotCamera 渲染的右下角小窗同位置同尺寸
            position: 'absolute',
            right: 16,
            bottom: 16,
            width: '28%',
            aspectRatio: '16 / 9',
            border: '1px solid #6fb7ff55',
            borderRadius: 2,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: 6,
              fontSize: 11,
              color: '#6fb7ff',
              opacity: 0.8,
            }}
          >
            镜头
          </span>
        </div>
      )}
      <GizmoModeHint mode={gizmoMode} />
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
      {libraryOpen && (
        <AssetLibraryPanel
          onPlaceModel={(entry: ModelEntry) => {
            startPlacingFromLibrary(entry).catch((err) =>
              console.warn('[placement] 库模型加载失败', err),
            )
          }}
          onApplyAnimation={applyAnimation}
          onApplyPose={applyPose}
          onSavePose={onSavePose}
          canSavePose={canSavePose}
          applyDisabled={!canApplyAnimation}
          disabled={rigLoading}
          filterRig={selectedRig}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {objectMenu && (
        <CanvasContextMenu
          position={{x: objectMenu.x, y: objectMenu.y}}
          items={buildObjectMenuItems({
            mode: gizmoMode,
            onSelectMode: setGizmoMode,
            onDelete: () => {
              deletePlacement(sheet, objectMenu.key)
              // 被删的对象留在选中列表里没意义，顺带清掉
              getStudioSync()?.setSelection([])
            },
          })}
          onClose={closeObjectMenu}
        />
      )}
      {pathMenu && (
        <CanvasContextMenu
          position={{x: pathMenu.x, y: pathMenu.y}}
          items={buildPathMenuItems({
            metaKey: pathMenu.metaKey,
            editing: editingPath === pathMenu.metaKey,
            onToggleEdit: () => {
              if (editingPath === pathMenu.metaKey) {
                exitPathEdit()
              } else {
                enterPathEdit(pathMenu.metaKey)
              }
            },
            onDelete: () => removePath(pathMenu.metaKey),
          })}
          onClose={closePathMenu}
        />
      )}
      {cameraMenu && (
        <CanvasContextMenu
          position={cameraMenu}
          items={buildCameraMenuItems({
            onViewShot: () => setShotView(true),
            onDeleteCamera: deleteCamera,
          })}
          onClose={closeCameraMenu}
        />
      )}
      {targetMissing && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px',
            background: '#3a2a2a',
            border: '1px solid #a55',
            borderRadius: 6,
            color: '#ffd9d9',
            fontSize: 13,
          }}
        >
          <span>Target 已删除,相机保持当前朝向(相机面板可恢复)</span>
        </div>
      )}
      {editingPath && !shotView && (
        <PathEditBar
          hasSelection={
            !!selectedPathPoint && selectedPathPoint.metaKey === editingPath
          }
          onAddPoint={addPosPathPoint}
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
            onPinAtPlayhead={
              editingPath === POS_PATH_KEY ? pinPathPointAtPlayhead : undefined
            }
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
          if (!placing) getStudioSync()?.setSelection([])
          // 控制点也取消选中,但路径编辑模式保持(编辑态是"粘"的)
          setSelectedPathPoint(null)
        }}
      >
        <SheetProvider sheet={sheet}>
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
              targetKey={entry.targetKey}
              makeDefault={shotView}
              cameraObjRef={shotCameraObjRef}
              targetObjRef={shotTargetObjRef}
              onCameraContextMenu={(x, y) => setCameraMenu({x, y})}
            />
          ))}
          {paths.map((entry) => (
            <CameraPath
              key={entry.pathKey}
              metaKey={entry.pathKey}
              // 普通态蓝色;选中/编辑的黄色档位在 CameraPath 内部
              color={0x4a90d9}
              hidden={shotView}
              editing={editingPath === entry.pathKey}
              selectedKey={
                selectedPathPoint?.metaKey === entry.pathKey
                  ? selectedPathPoint.key
                  : null
              }
              onSelectPoint={(key) =>
                setSelectedPathPoint(key ? {metaKey: entry.pathKey, key} : null)
              }
              onContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
              progressOf={pathProgressOf}
            />
          ))}
          <fog attach="fog" args={[bg, 16, 30]} />
          <color attach="background" args={[bg]} />
          <ambientLight intensity={0.75} />
          <PerspectiveCamera
            theatreKey="Camera / Camera"
            objRef={cameraObjRef}
            makeDefault={!shotView}
            position={[0, 0, 16]}
            fov={75}
            lookAt={cameraTargetRef}
          >
            <e.pointLight
              theatreKey="Light 1"
              intensity={1}
              position={[-10, -25, -10]}
            />
            <e.spotLight
              theatreKey="Light 2"
              castShadow
              intensity={2.25}
              angle={0.2}
              penumbra={1}
              position={[-25, 20, -15]}
              shadow-mapSize={[1024, 1024]}
              shadow-bias={-0.0001}
            />
            <e.directionalLight theatreKey="Light 3" />
          </PerspectiveCamera>
          <e.mesh
            ref={cameraTargetRef}
            theatreKey="Camera / Target"
            objRef={targetObjRef}
            position={[0, 0, 0]}
            visible="editor"
          >
            <boxGeometry attach="geometry" />
            <meshPhongMaterial attach="material" color="red" />
          </e.mesh>
          <Suspense fallback={null}>
            <RefreshSnapshot />
            <Model url={sceneGLB} selectLocked={!!placing} />
          </Suspense>
          {placing && (
            <Suspense fallback={null}>
              <PlacementRigErrorBoundary onCancel={cancelPlacing}>
                <PlacementRig
                  placing={placing}
                  onConfirm={confirmPlacing}
                  onCancel={cancelPlacing}
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
          <Stars radius={500} depth={50} count={1000} factor={10} />
        </SheetProvider>
      </Canvas>
    </div>
  )
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

export default App
