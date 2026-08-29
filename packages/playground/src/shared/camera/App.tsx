import {
  editable as e,
  RefreshSnapshot,
  SheetProvider,
  PerspectiveCamera,
} from '@toy-box/r3f'
import {
  Stars,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei'
import {getProject, getStudioSync, val} from '@toy-box/core'
import type {IScrub, ISheetObject} from '@toy-box/core'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {Canvas, useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import sceneGLB from './scene.glb'
import {MOUSE, Spherical, Vector3} from 'three'
import type {Mesh, Object3D} from 'three'
import {
  GizmoModeHint,
  ObjectContextMenu,
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
import {AssetLibraryPanel} from './assetLibrary/AssetLibraryPanel'
import {getLibrary} from './assetLibrary/library'
import {ShotCamera} from './ShotCamera'
import {
  addPathPoint,
  AIM_PATH_KEY,
  CameraPath,
  clearPath,
  deletePathPoint,
  getPathMeta,
  PathPointEditor,
  pathLabel,
  POS_PATH_KEY,
  readPathPoints,
  translatePath,
} from './CameraPath'
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
          receiveShadow
          castShadow
          geometry={nodes.planet002.geometry}
          material={nodes.planet002.material}
        />
        <e.mesh
          theatreKey="Example Namespace / Thingy / Debris 1"
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
  // 视频导出:菜单开关 / 进行中的导出句柄 / 导出前的视角(导完恢复)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportHandleRef = useRef<ShotExportHandle | null>(null)
  const prevShotViewRef = useRef(false)
  const pendingExportSinkRef = useRef<ExportSink | null>(null)
  // 运镜路径:加点/删点菜单开关
  const [pathMenuOpen, setPathMenuOpen] = useState(false)
  // 运镜路径编辑模式:正在编辑的路径 metaKey(同一时刻只编辑一条,
  // 对齐 Blender 的对象/编辑模式);右键路径线或 Tab 进出
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const lastEditedPathRef = useRef<string>(POS_PATH_KEY)
  const editingPathRef = useRef<string | null>(null)
  editingPathRef.current = editingPath
  // 选中的控制点(内部选中,和 studio 选区无关;控制点不是 theatre 对象)
  const [selectedPathPoint, setSelectedPathPoint] = useState<{
    metaKey: string
    key: string
  } | null>(null)
  // 右键路径线弹出的菜单:记录目标路径和光标位置
  const [pathMenu, setPathMenu] = useState<{
    metaKey: string
    x: number
    y: number
  } | null>(null)
  const project = getProject('Space')
  const sheet = project.sheet('Scene')
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
      // 选中了 theatre 对象 → 控制点取消选中(两套手柄不同时出现);
      // 路径编辑模式保持(编辑态是"粘"的,同 Blender)
      if (studio.selection.length > 0) setSelectedPathPoint(null)
    }
    sync()
    return studio.onSelectionChange(sync)
  }, [])

  // 进入/退出路径编辑模式(右键菜单和 Tab 共用)
  const enterPathEdit = useCallback((metaKey: string) => {
    setEditingPath(metaKey)
    lastEditedPathRef.current = metaKey
    // 编辑路径时清掉对象选中:对象 gizmo 和控制点 gizmo 不同时出现
    getStudioSync()?.setSelection([])
  }, [])
  const exitPathEdit = useCallback(() => {
    setEditingPath(null)
    setSelectedPathPoint(null)
  }, [])

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
        // 有选中的路径就编辑它(Blender:Tab 作用于选中物),
        // 没有才回退到最后编辑的那条
        const studio = getStudioSync()
        const selectedPath =
          studio &&
          [POS_PATH_KEY, AIM_PATH_KEY].find((k) =>
            (studio.selection as unknown[]).includes(getPathMeta(sheet, k)),
          )
        enterPathEdit(selectedPath || lastEditedPathRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, shotView, enterPathEdit, exitPathEdit])

  // 切镜头视角自动退出编辑模式(路径在镜头视角本就全部隐藏)
  useEffect(() => {
    if (shotView) exitPathEdit()
  }, [shotView, exitPathEdit])

  // 调试/自动化验证挂钩:读当前编辑态、直接进出编辑模式
  useEffect(() => {
    ;(window as any).__cameraPathEdit = {
      enter: enterPathEdit,
      exit: exitPathEdit,
      current: () => editingPathRef.current,
    }
  }, [enterPathEdit, exitPathEdit])

  // 运镜路径菜单动作:加点(空路径先播种)、删除选中的控制点。
  // 播种时同一次提交把驱动切到"沿路径"(Blender 的约束加上即生效):
  // 相机/Target 当场归路径管、移动箭头锁定;想手动在属性面板切回即可
  const addPosPathPoint = useCallback(() => {
    const cam = shotCameraObjRef.current
    const target = shotTargetObjRef.current
    // 空路径播种:从当前机位出发绕目标画一段弧,立即可用
    const seed =
      cam && target
        ? seedArcPoints(val(cam.props.position), val(target.props.position))
        : undefined
    addPathPoint(sheet, POS_PATH_KEY, seed, (set) => {
      if (cam) set(cam.props.moveMode, 'path')
    })
    // 加点后直接进入编辑模式,马上能看到/拖到这个点
    enterPathEdit(POS_PATH_KEY)
  }, [sheet, enterPathEdit])

  const addAimPathPoint = useCallback(() => {
    const cam = shotCameraObjRef.current
    const target = shotTargetObjRef.current
    // 聚焦路径播种:目标处一个点 = 锁死主体,随时再加点变扫视
    const seed = target ? [val(target.props.position)] : undefined
    addPathPoint(sheet, AIM_PATH_KEY, seed, (set) => {
      if (cam) set(cam.props.aimMode, 'path')
    })
    enterPathEdit(AIM_PATH_KEY)
  }, [sheet, enterPathEdit])

  const removePathPoint = useCallback(() => {
    if (
      selectedPathPoint &&
      deletePathPoint(sheet, selectedPathPoint.metaKey, selectedPathPoint.key)
    ) {
      setSelectedPathPoint(null)
    } else {
      window.alert('先进入路径编辑模式(右键路径线或按 Tab),点选一个控制点')
    }
  }, [sheet, selectedPathPoint])

  // 删除整条路径:名单清空(撤销可整条找回);正在编辑/选中了它的点
  // 就一并退出/清掉。已经是空路径时不动作
  const removePath = useCallback(
    (metaKey: string) => {
      if (readPathPoints(sheet, metaKey).length === 0) {
        window.alert(`${pathLabel(metaKey)}已经是空的`)
        return
      }
      clearPath(sheet, metaKey)
      if (editingPath === metaKey) exitPathEdit()
      if (selectedPathPoint?.metaKey === metaKey) setSelectedPathPoint(null)
    },
    [sheet, editingPath, selectedPathPoint, exitPathEdit],
  )

  // 对齐(Blender 吸附工作流的对应物):手动机位和路径是两份数据,
  // 路径驱动时手动那份被忽略,可能悄悄岔开;两个动作一键对齐。
  // 各一次 scrub 提交 = 一步撤销
  const alignCameraToPathStart = useCallback(() => {
    const cam = shotCameraObjRef.current
    const pts = readPathPoints(sheet, POS_PATH_KEY)
    const studio = getStudioSync()
    if (!cam || pts.length === 0 || !studio) return
    const p = pts[0]!.position
    const scrub = studio.scrub()
    scrub.capture(({set}) => set(cam.props.position, {x: p.x, y: p.y, z: p.z}))
    scrub.commit()
  }, [sheet])

  const movePathToCamera = useCallback(() => {
    const cam = shotCameraObjRef.current
    const pts = readPathPoints(sheet, POS_PATH_KEY)
    if (!cam || pts.length === 0) return
    const c = val(cam.props.position)
    const p = pts[0]!.position
    translatePath(sheet, POS_PATH_KEY, {
      x: c.x - p.x,
      y: c.y - p.y,
      z: c.z - p.z,
    })
  }, [sheet])

  // 路径上的进度标记读 Shot/Camera 的进度属性(对象还没建好时报 0)
  const posProgressOf = useCallback(
    () =>
      shotCameraObjRef.current
        ? val(shotCameraObjRef.current.props.posProgress)
        : 0,
    [],
  )
  const aimProgressOf = useCallback(
    () =>
      shotCameraObjRef.current
        ? val(shotCameraObjRef.current.props.aimProgress)
        : 0,
    [],
  )

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
      <button
        disabled={!!placing}
        onClick={() => setLibraryOpen((v) => !v)}
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid #444',
          background: placing ? '#333' : '#272730',
          color: placing ? '#888' : '#eee',
          cursor: placing ? 'default' : 'pointer',
          fontSize: 13,
        }}
      >
        {placing ? '放置中:左键确认落点,Esc/右键取消' : '资产库'}
      </button>
      <button
        onClick={() => {
          // 导出中禁止切视角:录的是 canvas 内容,切走就录进编辑画面了
          if (exporting) return
          setShotView((v) => !v)
        }}
        style={{
          position: 'absolute',
          top: 12,
          // 试过放右侧(50%+62):正中小一个隐形的 studio 顶层区域,点击被吞
          left: 'calc(50% - 152px)',
          zIndex: 10,
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid #444',
          background: shotView ? '#3a4a63' : '#272730',
          color: exporting ? '#888' : '#eee',
          cursor: exporting ? 'default' : 'pointer',
          fontSize: 13,
        }}
        title="在导演视角和场景摄像机取景之间切换(Blender 的数字键 0)"
      >
        {shotView ? '返回导演视角' : '镜头视角'}
      </button>
      <button
        onClick={() => {
          if (exporting) {
            exportHandleRef.current?.finishEarly()
            return
          }
          setExportMenuOpen((v) => !v)
        }}
        style={{
          position: 'absolute',
          top: 12,
          // 镜头视角按钮再往左,同样避开隐形 studio 区域
          left: 'calc(50% - 272px)',
          zIndex: 10,
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid #444',
          background: exporting ? '#633a3a' : '#272730',
          color: '#eee',
          cursor: 'pointer',
          fontSize: 13,
        }}
        title="把镜头取景实时录成视频:序列从头播到尾,录完自动保存"
      >
        {exporting ? '停止并保存(Esc 取消)' : '导出视频'}
      </button>
      <button
        onClick={() => setPathMenuOpen((v) => !v)}
        style={{
          position: 'absolute',
          top: 12,
          // 导出视频按钮再往左,同样避开隐形 studio 区域
          left: 'calc(50% - 392px)',
          zIndex: 10,
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid #444',
          background: '#272730',
          color: '#eee',
          cursor: 'pointer',
          fontSize: 13,
        }}
        title="运镜路径:机位/聚焦各一条;右键路径线或按 Tab 进入编辑模式,拖控制点和贝塞尔手柄摆路径;播种后自动沿路径驱动(属性面板可切回手动),进度打关键帧调运镜节奏"
      >
        路径
      </button>
      {pathMenuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 46,
            left: 'calc(50% - 392px)',
            zIndex: 11,
            background: '#272730',
            border: '1px solid #444',
            borderRadius: 6,
            padding: 4,
            minWidth: 220,
          }}
        >
          {[
            {
              label: '机位路径 · 加点',
              desc: '第一次点:从当前机位播种一段环绕弧,并自动切到沿路径驱动',
              onClick: addPosPathPoint,
            },
            {
              label: '聚焦路径 · 加点',
              desc: '第一次点:在目标处放一个点(锁死主体),并自动切到沿路径驱动',
              onClick: addAimPathPoint,
            },
            {
              label: '相机对齐到路径起点',
              desc: '把手动机位设成机位路径的第一个点',
              onClick: alignCameraToPathStart,
            },
            {
              label: '路径平移到相机',
              desc: '整条机位路径平移,起点落到当前手动机位',
              onClick: movePathToCamera,
            },
            {
              label: '机位路径 · 删除',
              desc: '整条删除(控制点全清);撤销可整条找回',
              onClick: () => removePath(POS_PATH_KEY),
            },
            {
              label: '聚焦路径 · 删除',
              desc: '整条删除(控制点全清);撤销可整条找回',
              onClick: () => removePath(AIM_PATH_KEY),
            },
            {
              label: '删除选中的控制点',
              desc: '编辑模式(右键路径线/Tab)里先点选一个控制点',
              onClick: removePathPoint,
            },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setPathMenuOpen(false)
                item.onClick()
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: '#eee',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {item.label}
              <span style={{display: 'block', fontSize: 11, color: '#999'}}>
                {item.desc}
              </span>
            </button>
          ))}
        </div>
      )}
      {exportMenuOpen && !exporting && (
        <div
          style={{
            position: 'absolute',
            top: 46,
            left: 'calc(50% - 272px)',
            zIndex: 11,
            background: '#272730',
            border: '1px solid #444',
            borderRadius: 6,
            padding: 4,
            minWidth: 220,
          }}
        >
          {listSinks().map((sink) => (
            <button
              key={sink.id}
              onClick={() => {
                setExportMenuOpen(false)
                prevShotViewRef.current = shotView
                // 先切镜头视角,useEffect 里等切完再开录
                pendingExportSinkRef.current = sink
                setShotView(true)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: '#eee',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {sink.label}
              <span style={{display: 'block', fontSize: 11, color: '#999'}}>
                {sink.description}
              </span>
            </button>
          ))}
        </div>
      )}
      {!shotView && (
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
        <ObjectContextMenu
          position={{x: objectMenu.x, y: objectMenu.y}}
          mode={gizmoMode}
          onSelectMode={setGizmoMode}
          onDelete={() => {
            deletePlacement(sheet, objectMenu.key)
            // 被删的对象留在选中列表里没意义,顺带清掉
            getStudioSync()?.setSelection([])
          }}
          onClose={() => setObjectMenu(null)}
        />
      )}
      {pathMenu && (
        <PathContextMenu
          position={{x: pathMenu.x, y: pathMenu.y}}
          metaKey={pathMenu.metaKey}
          editing={editingPath === pathMenu.metaKey}
          onToggleEdit={() => {
            if (editingPath === pathMenu.metaKey) {
              exitPathEdit()
            } else {
              enterPathEdit(pathMenu.metaKey)
            }
          }}
          onDelete={() => removePath(pathMenu.metaKey)}
          onClose={() => setPathMenu(null)}
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
          <ShotCamera
            makeDefault={shotView}
            cameraObjRef={shotCameraObjRef}
            targetObjRef={shotTargetObjRef}
            onPathContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
          />
          <CameraPath
            metaKey={POS_PATH_KEY}
            color={0xffcc33}
            hidden={shotView}
            editing={editingPath === POS_PATH_KEY}
            selectedKey={
              selectedPathPoint?.metaKey === POS_PATH_KEY
                ? selectedPathPoint.key
                : null
            }
            onSelectPoint={(key) =>
              setSelectedPathPoint(key ? {metaKey: POS_PATH_KEY, key} : null)
            }
            onContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
            progressOf={posProgressOf}
          />
          <CameraPath
            metaKey={AIM_PATH_KEY}
            color={0xffcc33}
            hidden={shotView}
            editing={editingPath === AIM_PATH_KEY}
            selectedKey={
              selectedPathPoint?.metaKey === AIM_PATH_KEY
                ? selectedPathPoint.key
                : null
            }
            onSelectPoint={(key) =>
              setSelectedPathPoint(key ? {metaKey: AIM_PATH_KEY, key} : null)
            }
            onContextMenu={(metaKey, x, y) => setPathMenu({metaKey, x, y})}
            progressOf={aimProgressOf}
          />
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
 * 路径线的右键菜单:进出编辑模式(Tab 是同款快捷键,菜单里标出来)。
 * 样式对齐 ObjectContextMenu。
 */
function PathContextMenu({
  position,
  metaKey,
  editing,
  onToggleEdit,
  onDelete,
  onClose,
}: {
  position: {x: number; y: number}
  metaKey: string
  editing: boolean
  onToggleEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onPointerDown = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement | null)?.closest('[data-path-menu]'))
        onClose()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      data-path-menu
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 20,
        minWidth: 160,
        padding: '4px 0',
        borderRadius: 8,
        background: 'rgba(24,24,28,0.96)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 14px 6px 12px',
          fontSize: 13,
          color: 'rgba(255,255,255,0.9)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        onClick={() => {
          onToggleEdit()
          onClose()
        }}
      >
        <span>
          {editing ? '退出编辑' : '编辑路径'}({pathLabel(metaKey)})
        </span>
        <span
          style={{marginLeft: 12, fontSize: 11, color: 'rgba(255,255,255,0.4)'}}
        >
          Tab
        </span>
      </div>
      <div
        style={{
          height: 1,
          margin: '4px 0',
          background: 'rgba(255,255,255,0.12)',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 14px 6px 12px',
          fontSize: 13,
          color: '#ff6b6b',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'rgba(255,107,107,0.12)')
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        onClick={() => {
          onDelete()
          onClose()
        }}
      >
        <span>删除路径({pathLabel(metaKey)})</span>
      </div>
    </div>
  )
}

export default App
