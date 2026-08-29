import {editable as e, PerspectiveCamera, useCurrentSheet} from '@toy-box/r3f'
import {getStudioSync, types as t, val} from '@toy-box/core'
import type {ISheetObject} from '@toy-box/core'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import type {MutableRefObject} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three'
import type {PerspectiveCamera as PerspectiveCameraImpl} from 'three'
import {registerEditorOnly, withEditorOnlyHidden} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {
  AIM_PATH_KEY,
  POS_PATH_KEY,
  samplePathPoint,
  usePathHasPoints,
} from './CameraPath'

/**
 * 场景摄像机(shot camera):独立于编辑主视角的"镜头",取景画面用于
 * 画中画预览和之后的视频导出,对标 Blender 的场景 Camera 对象。
 *
 * - theatre 对象 Shot/Camera(位置/旋转/fov 可上时间轴)+ Shot/Target
 *   (瞄准点),朝向每帧 lookAt 瞄准代理,和主相机同一套语义
 * - 运镜驱动(见 shotCameraAdditionalProps):机位/朝向都可以切到
 *   "沿路径",由 CameraPath 的曲线 + 本对象的 0~1 进度属性驱动,
 *   进度打关键帧 = 调运镜节奏;路径为空时回退手动,不产生异常画面
 * - 编辑器里的视锥示意:从相机顶点拉 4 条线到固定距离的末端平面,
 *   平面画成半透明色块(自绘 LineSegments + 半透明 Plane,不用
 *   CameraHelper——它无法被 scene.clone() 复制,r3f 快照编辑器克隆
 *   场景时必炸),点线或色块即选中摄像机,挂三轴箭头拖动摆机位;
 *   Target 线框小方块同理。机位/朝向被路径接管时箭头不出现
 *   (对齐 Blender 的约束:驱动期间物体拖不动,要挪就挪路径/进度)
 * - 画中画:右下角小窗实时渲染镜头取景;切到"镜头视角"时全屏取景
 * - 视锥线/手柄/选中箭头都登记进 editorOnly,画中画与镜头视角渲染时
 *   隐藏,取景画面始终干净
 */

const PIP_WIDTH_FRACTION = 0.28
const PIP_MARGIN_PX = 16
const FRUSTUM_COLOR = 0x6fb7ff
/** 视锥示意线的末端距离(示意用,与相机实际 far 无关) */
const FRUSTUM_DISPLAY_LENGTH = 3
/** 末端平面的不透明度 */
const FRUSTUM_FILL_OPACITY = 0.12

/**
 * 运镜驱动的四个属性,挂在 Shot/Camera 对象上(模块级常量:
 * sheet.object 重复调用要求配置 deep-equal,函数按引用比,
 * 每次 render 新建会在热更新后炸"called twice with different config")。
 * moveMode=path 时机位由机位路径 + posProgress 驱动,position 属性被忽略;
 * aimMode=path 时朝向由聚焦路径 + aimProgress 驱动,否则看 Target。
 * 两个进度分开打关键帧:聚焦可以比机位先到位/晚半拍,这是运镜呼吸感的来源。
 */
const shotCameraAdditionalProps = {
  moveMode: t.stringLiteral(
    'manual',
    {manual: '手动', path: '沿机位路径'},
    {label: '机位驱动'},
  ),
  aimMode: t.stringLiteral(
    'target',
    {target: '目标点', path: '沿聚焦路径'},
    {label: '朝向驱动'},
  ),
  posProgress: t.number(0, {range: [0, 1], label: '机位进度'}),
  aimProgress: t.number(0, {range: [0, 1], label: '聚焦进度'}),
}

/** 视锥线:末端平面矩形 4 段 + 顶点→平面 4 角 = 8 段 */
function makeFrustumLines(): LineSegments {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(16 * 3), 3))
  const lines = new LineSegments(
    geo,
    new LineBasicMaterial({color: FRUSTUM_COLOR, toneMapped: false}),
  )
  // 顶点逐帧重写,包围球不更新,关掉视锥剔除防止被误剔
  lines.frustumCulled = false
  return lines
}

/** 末端半透明显示面(示意取景框,单位平面,逐帧按 fov/aspect 缩放) */
function makeFrustumFill(): Mesh {
  const fill = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      color: FRUSTUM_COLOR,
      transparent: true,
      opacity: FRUSTUM_FILL_OPACITY,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  fill.position.z = -FRUSTUM_DISPLAY_LENGTH
  return fill
}

/** 按相机当前 fov/aspect 重写视锥顶点和显示面尺寸(挂在相机节点下,用视空间坐标) */
function updateFrustum(
  lines: LineSegments,
  fill: Mesh,
  cam: PerspectiveCameraImpl,
) {
  const {fov, aspect} = cam
  const tan = Math.tan((fov * Math.PI) / 360)
  const h = tan * FRUSTUM_DISPLAY_LENGTH
  const w = h * aspect
  const z = -FRUSTUM_DISPLAY_LENGTH
  const corners = [
    [-w, -h, z],
    [w, -h, z],
    [w, h, z],
    [-w, h, z],
  ]
  const apex = [0, 0, 0]
  const attr = lines.geometry.getAttribute('position') as BufferAttribute
  const arr = attr.array as Float32Array
  let o = 0
  const seg = (a: number[], b: number[]) => {
    arr[o++] = a[0]
    arr[o++] = a[1]
    arr[o++] = a[2]
    arr[o++] = b[0]
    arr[o++] = b[1]
    arr[o++] = b[2]
  }
  for (let i = 0; i < 4; i++) {
    seg(corners[i], corners[(i + 1) % 4])
    seg(apex, corners[i])
  }
  attr.needsUpdate = true
  fill.scale.set(2 * w, 2 * h, 1)
}

export function ShotCamera({
  makeDefault,
  cameraObjRef,
  targetObjRef,
  onPathContextMenu,
}: {
  /** true = 镜头视角全屏(主相机让位);false = 编辑视角,右下角画中画 */
  makeDefault: boolean
  cameraObjRef: MutableRefObject<ISheetObject<any> | undefined>
  targetObjRef: MutableRefObject<ISheetObject<any> | undefined>
  /** 右键相机/Target:弹绑定路径的编辑菜单(机位路径绑相机,聚焦路径绑 Target) */
  onPathContextMenu?: (metaKey: string, x: number, y: number) => void
}) {
  const camRef = useRef<PerspectiveCameraImpl>(null!)
  const targetRef = useRef<Mesh>(null!)
  // 瞄准代理:wrapper 的 lookAt 每帧读它的位置。瞄准目标(Target 方块
  // 或聚焦路径上的点)在优先级 -1 先写进代理,wrapper 优先级 0 的
  // lookAt 读到的就是本帧的值,朝向不晚一帧
  const aimRef = useRef<Object3D>(new Object3D())
  const frustum = useMemo(makeFrustumLines, [])
  const frustumFill = useMemo(makeFrustumFill, [])

  // 驱动锁(对齐 Blender 的约束语义):机位/朝向被路径接管期间,
  // 相机/Target 拖了也不生效,干脆不登记选中 gizmo——箭头和 G 抓取
  // 都不出现,从源头消灭"拖了没反应、数据还悄悄岔开"的假动作。
  // 空路径驱动自动回退手动,不锁
  const sheet = useCurrentSheet()!
  const posPathHasPoints = usePathHasPoints(sheet, POS_PATH_KEY)
  const aimPathHasPoints = usePathHasPoints(sheet, AIM_PATH_KEY)
  const [driveModes, setDriveModes] = useState({move: 'manual', aim: 'target'})
  useEffect(() => {
    const obj = cameraObjRef.current
    if (!obj) return
    // onValuesChange 任何值变都会来(播放中的进度属性每帧都变),
    // 模式没变就返回原引用,不触发重渲染
    const update = () =>
      setDriveModes((prev) => {
        const move = val(obj.props.moveMode)
        const aim = val(obj.props.aimMode)
        return prev.move === move && prev.aim === aim ? prev : {move, aim}
      })
    update()
    return obj.onValuesChange(update)
    // objRef 由下面的 PerspectiveCamera wrapper 挂载时填充,效果跑时已就绪
  }, [cameraObjRef])
  const camDriveLocked = driveModes.move === 'path' && posPathHasPoints
  const targetDriveLocked = driveModes.aim === 'path' && aimPathHasPoints

  // 选中后挂三轴移动箭头:摄像机本体和瞄准点都能拖(路径接管时除外,见上)
  useSelectionGizmoTarget(cameraObjRef, camRef, !camDriveLocked)
  useSelectionGizmoTarget(targetObjRef, targetRef, !targetDriveLocked)

  // 运镜驱动(优先级 -1,赶在 wrapper 的 lookAt 之前):
  // 机位路径非空且 moveMode=path → 机位取路径上 posProgress 处;
  // aimMode=path 且聚焦路径非空 → 瞄准取聚焦路径上 aimProgress 处,
  // 否则瞄准 Target。路径为空时自动回退,不会出现"相机消失"
  const pathSampleTmp = useRef(new Vector3())
  useFrame(() => {
    const cam = camRef.current
    const obj = cameraObjRef.current
    if (!cam || !obj) return
    const tmp = pathSampleTmp.current
    if (
      val(obj.props.moveMode) === 'path' &&
      samplePathPoint(POS_PATH_KEY, val(obj.props.posProgress), tmp)
    ) {
      cam.position.copy(tmp)
    }
    if (
      val(obj.props.aimMode) === 'path' &&
      samplePathPoint(AIM_PATH_KEY, val(obj.props.aimProgress), tmp)
    ) {
      aimRef.current.position.copy(tmp)
    } else if (targetRef.current) {
      aimRef.current.position.copy(targetRef.current.position)
    }
  }, -1)

  // 视锥线/显示面/瞄准点手柄只在编辑视角出现;镜头视角全屏时人已经在镜头里,直接藏
  useEffect(() => registerEditorOnly(frustum), [frustum])
  useEffect(() => registerEditorOnly(frustumFill), [frustumFill])
  useEffect(() => registerEditorOnly(targetRef.current), [])
  useEffect(() => {
    frustum.visible = !makeDefault
    frustumFill.visible = !makeDefault
    if (targetRef.current) targetRef.current.visible = !makeDefault
  }, [makeDefault, frustum, frustumFill])

  useFrame(() => {
    if (camRef.current && frustum.visible) {
      updateFrustum(frustum, frustumFill, camRef.current)
    }
  })

  // 调试/自动化验证挂钩:浏览器里直接读 three 相机本体
  useEffect(() => {
    ;(window as any).__shotCam3 = camRef.current
  }, [])

  // 点视锥线 = 选中摄像机;点 Target 方块 = 选中瞄准点
  const select =
    (objRef: MutableRefObject<ISheetObject<any> | undefined>) =>
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      const studio = getStudioSync()
      if (studio && objRef.current) {
        studio.setSelection([objRef.current])
      }
    }

  // 右键 = 选中 + 弹绑定路径的菜单(相机→机位路径,Target→聚焦路径),
  // 和右键路径线本身弹的是同一个菜单
  const contextMenu =
    (
      objRef: MutableRefObject<ISheetObject<any> | undefined>,
      metaKey: string,
    ) =>
    (event: ThreeEvent<MouseEvent>) => {
      if (!onPathContextMenu) return
      event.stopPropagation()
      event.nativeEvent.preventDefault()
      const studio = getStudioSync()
      if (studio && objRef.current) {
        studio.setSelection([objRef.current])
      }
      onPathContextMenu(
        metaKey,
        event.nativeEvent.clientX,
        event.nativeEvent.clientY,
      )
    }

  return (
    <>
      <PerspectiveCamera
        theatreKey="Shot / Camera"
        objRef={cameraObjRef}
        ref={camRef}
        makeDefault={makeDefault}
        manual
        position={[8, 3, 8]}
        fov={50}
        near={0.1}
        far={60}
        lookAt={aimRef}
        additionalProps={shotCameraAdditionalProps}
      >
        <primitive
          object={frustum}
          onClick={select(cameraObjRef)}
          onContextMenu={contextMenu(cameraObjRef, POS_PATH_KEY)}
        />
        <primitive
          object={frustumFill}
          onClick={select(cameraObjRef)}
          onContextMenu={contextMenu(cameraObjRef, POS_PATH_KEY)}
        />
      </PerspectiveCamera>
      <e.mesh
        theatreKey="Shot / Target"
        objRef={targetObjRef}
        ref={targetRef}
        position={[0, 1, 0]}
        onClick={select(targetObjRef)}
        onContextMenu={contextMenu(targetObjRef, AIM_PATH_KEY)}
      >
        <boxGeometry args={[0.25, 0.25, 0.25]} />
        <meshBasicMaterial color="#ffb020" wireframe />
      </e.mesh>
      <ShotCameraRenderer camRef={camRef} pip={!makeDefault} />
    </>
  )
}

/**
 * 渲染镜头取景:编辑视角时叠到右下角画中画,镜头视角时全屏。
 * useFrame 优先级 2,必须高于 drei Hud(GizmoNav 导航块)的 1——
 * Hud 每帧先全屏重画默认场景,同优先级或更低的内容都会被它盖掉;
 * 主视角因此交给 Hud 画,这里只画小窗/全屏取景,互不覆盖。
 * frameloop="demand" 的按需语义不变(本组件不额外要帧)。
 */
function ShotCameraRenderer({
  camRef,
  pip,
}: {
  camRef: MutableRefObject<PerspectiveCameraImpl>
  pip: boolean
}) {
  // frameloop="demand":切换镜头视角/画中画只是 React 状态变化,
  // 不触发新帧的话画布上会留着上一帧(全屏取景的右下角)当"画中画"
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    invalidate()
  }, [pip, invalidate])

  // 渲染分工(踩过的坑,别改回自己画主视角):
  // drei Hud(GizmoNav 的导航块)的 useFrame 以优先级 1 每帧先全屏画
  // 默认场景再叠导航块——它会把同优先级先画的任何内容整个覆盖掉,
  // 画中画就是这么被冲成主视角画面的。所以这里:
  //   编辑视角:主视角交给 Hud 画,本回调只以优先级 2 把镜头取景
  //           叠到右下角小窗(剪刀限定,不碰导航块);
  //   镜头视角:GizmoNav 已卸载,没有 Hud,本回调全屏画镜头取景。
  useFrame(({gl, scene, size}) => {
    const shotCam = camRef.current
    if (!shotCam) return
    const w = size.width
    const h = size.height

    if (!pip) {
      // 镜头视角:全屏取景(wrapper 传了 manual,aspect 归这里管)
      shotCam.aspect = w / h
      shotCam.updateProjectionMatrix()
      gl.render(scene, shotCam)
      return
    }

    const pipW = Math.round(w * PIP_WIDTH_FRACTION)
    const pipH = Math.round((pipW * 9) / 16)
    const x = w - pipW - PIP_MARGIN_PX
    const y = PIP_MARGIN_PX // gl viewport 原点在左下角

    withEditorOnlyHidden(() => {
      shotCam.aspect = pipW / pipH
      shotCam.updateProjectionMatrix()
      // setViewport/setScissor 接收 CSS 像素,three 内部会自己乘 pixelRatio,
      // 这里再乘一遍 dpr 矩形会被推到画布外(踩过这个坑)
      gl.setViewport(x, y, pipW, pipH)
      gl.setScissor(x, y, pipW, pipH)
      gl.setScissorTest(true)
      // autoClear 保持 true:剪刀会把清屏裁到小窗内,颜色和深度都清。
      // 不关 autoClear 的话,主视角的深度值留在小窗区域,
      // 会把小窗里的片元深度测试杀掉(踩过:画面只剩零星碎屑)
      gl.render(scene, shotCam)
      gl.setScissorTest(false)
      gl.setViewport(0, 0, w, h)
    })
  }, 2)
  return null
}
