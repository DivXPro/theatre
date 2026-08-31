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
  Euler,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
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
  POS_PATH_KEY,
  getPathMeta,
  pathObjectName,
  samplePathPoint,
  usePathHasPoints,
} from './CameraPath'

/**
 * 场景摄像机(shot camera):独立于编辑主视角的"镜头",取景画面用于
 * 画中画预览和之后的视频导出,对标 Blender 的场景 Camera 对象。
 *
 * - theatre 对象 Shot/Camera(位置/旋转/fov 可上时间轴)+ Shot/Target
 *   (瞄准点),朝向始终 lookAt Target——对齐 Blender 的 Track To 约束:
 *   相机没有"朝向模式",目标怎么动是它的自由(Target 的移动直接在
 *   时间轴上给 position 打关键帧,不需要单独的路径对象)
 * - 运镜驱动:机位可以切到"沿路径"(Shot/Camera 的 moveMode 开关,
 *   对齐 Blender 的约束跟随),由 CameraPath 的曲线 + 路径对象的
 *   行进进度(0~1,对齐曲线侧的 Evaluation Time)驱动,
 *   进度打关键帧 = 调运镜节奏;路径为空时回退手动,不产生异常画面
 * - 编辑器里的视锥示意:从相机顶点拉 4 条线到固定距离的末端平面,
 *   平面画成半透明色块(自绘 LineSegments + 半透明 Plane,不用
 *   CameraHelper——它无法被 scene.clone() 复制,r3f 快照编辑器克隆
 *   场景时必炸),点线或色块即选中摄像机,挂三轴箭头拖动摆机位;
 *   Target 线框小方块同理。机位被路径接管时相机箭头不出现
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
 * 运镜驱动属性,挂在 Shot/Camera 对象上(模块级常量:
 * sheet.object 重复调用要求配置 deep-equal,函数按引用比,
 * 每次 render 新建会在热更新后炸"called twice with different config")。
 *
 * 分工对齐 Blender 的 Follow Path:**跟随开关归相机**(moveMode=path 时
 * 机位由机位路径驱动,position 属性被忽略),**行进进度归路径**
 * (Pos Path 对象的 progress 属性,打关键帧 = 调运镜节奏;
 * 对齐曲线侧的 Evaluation Time)。路径为空时回退手动,不产生异常画面。
 * trackTarget=false = 解除朝向绑定(对齐 Blender 关掉 Track To 约束):
 * 解绑瞬间把当前朝向定格进 rotation 属性,画面不跳。
 * targetHidden=true = 软删除 Target(真删要绕过 React 声明式重建,代价
 * 不值;开关放相机面板是因为它是"镜头机组"的设置):Target 网格隐藏、
 * 不可点、不挂移动箭头,绑定的相机自动解脱保持当前朝向;对象还在
 * 大纲里,改回来就恢复。
 */
const shotCameraAdditionalProps = {
  trackTarget: t.boolean(true, {label: '朝向绑定 Target'}),
  targetHidden: t.boolean(false, {label: '删除 Target(可恢复)'}),
  moveMode: t.stringLiteral(
    'manual',
    // 选项 = 手动 / 路径对象的真名(对齐 Blender 约束的目标选择:
    // 选的是"跟随谁",显示对象在大纲里的名字)
    {manual: '手动', path: pathObjectName(POS_PATH_KEY)},
    {label: '机位驱动'},
  ),
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

/** 响应式读对象的某个标量属性(值没变就返回原引用,不触发重渲染) */
function useObjPropScalar<T>(
  objRef: MutableRefObject<ISheetObject<any> | undefined>,
  prop: string,
  fallback: T,
): T {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    const obj = objRef.current
    if (!obj) return
    // onValuesChange 任何值变都会来(播放中的进度属性每帧都变),
    // 值没变就返回原引用,不触发重渲染
    const update = () => {
      const next = val(obj.props[prop]) as T
      setValue((prev) => (prev === next ? prev : next))
    }
    update()
    return obj.onValuesChange(update)
    // objRef 由下面的 wrapper 挂载时填充,效果跑时已就绪
  }, [objRef, prop])
  return value
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
  /** 右键相机:弹机位路径的编辑菜单(和右键路径线本身弹的是同一个) */
  onPathContextMenu?: (metaKey: string, x: number, y: number) => void
}) {
  const camRef = useRef<PerspectiveCameraImpl>(null!)
  const targetRef = useRef<Mesh>(null!)
  // 瞄准代理:wrapper 的 lookAt 每帧读它的位置。Target 的位置在优先级
  // -1 先写进代理,wrapper 优先级 0 的 lookAt 读到的就是本帧的值,
  // 朝向不晚一帧
  const aimRef = useRef<Object3D>(new Object3D())
  const frustum = useMemo(makeFrustumLines, [])
  const frustumFill = useMemo(makeFrustumFill, [])

  // 驱动锁(对齐 Blender 的约束语义):机位被路径接管期间,
  // 相机拖了也不生效,干脆不登记选中 gizmo——箭头和 G 抓取
  // 都不出现,从源头消灭"拖了没反应、数据还悄悄岔开"的假动作。
  // 空路径驱动自动回退手动,不锁
  const sheet = useCurrentSheet()!
  // 行进进度在路径对象上(对齐 Blender:进度的家是曲线,不是相机)
  const posPathMeta = useMemo(() => getPathMeta(sheet, POS_PATH_KEY), [sheet])
  const posPathHasPoints = usePathHasPoints(sheet, POS_PATH_KEY)
  const camMoveMode = useObjPropScalar<string>(
    cameraObjRef,
    'moveMode',
    'manual',
  )
  const camDriveLocked = camMoveMode === 'path' && posPathHasPoints

  // 朝向绑定(Track To):trackTarget 是相机面板上的开关;Target 被软删
  // (相机面板的 targetHidden)时绑定自动失效——两种失效都把当前朝向
  // 定格进 rotation 属性,画面不跳(对齐 Blender:约束失效,物体保持
  // 当前变换)
  const trackTarget = useObjPropScalar(cameraObjRef, 'trackTarget', true)
  const targetHidden = useObjPropScalar(cameraObjRef, 'targetHidden', false)
  const tracking = trackTarget && !targetHidden
  // 失效瞬间定格:theatre 值变化会触发包装器全量应用属性,过期的
  // rotation 可能已把相机顶回——但位置没变,用瞄准点位置重算朝向
  // (Matrix4.lookAt 与相机 lookAt 同语义:-Z 朝目标),就是用户看到
  // 的最后画面。不存"上一帧四元数":按需渲染下可能没有上一帧
  const prevTrackingRef = useRef<boolean | null>(null)
  const capturePosTmp = useRef(new Vector3())
  useEffect(() => {
    const prev = prevTrackingRef.current
    prevTrackingRef.current = tracking
    // prev=null 是挂载后的首次跑(持久态恢复:trackTarget 初值 fallback
    // 是 true,恢复出 false 会假摔一次)——持久态里的 rotation 本来
    // 就是对的,跳过
    if (prev !== true || tracking) return
    const cam = camRef.current
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!cam || !obj || !studio) return
    // 此刻包装器刚全量应用过属性、帧驱动还没跑:机位被路径接管时
    // cam.position 是过期的 position 属性值,不是画面里的真实机位——
    // 真实机位用路径采样重算;瞄准点直接读 Target 网格(包装器同步
    // 应用过属性,比每帧镜像的 aimRef 新)
    const sampled = capturePosTmp.current
    const from =
      val(obj.props.moveMode) === 'path' &&
      samplePathPoint(POS_PATH_KEY, val(posPathMeta.props.progress), sampled)
        ? sampled
        : cam.position
    const m = new Matrix4().lookAt(from, targetRef.current.position, cam.up)
    const e = new Euler().setFromRotationMatrix(m, 'XYZ')
    const scrub = studio.scrub()
    scrub.capture(({set}) => set(obj.props.rotation, {x: e.x, y: e.y, z: e.z}))
    scrub.commit()
  }, [tracking, cameraObjRef, posPathMeta])

  // 选中后挂三轴移动箭头:摄像机本体和瞄准点都能拖(机位被路径接管时
  // 相机除外,见上;Target 被软删后也不可拖)
  useSelectionGizmoTarget(cameraObjRef, camRef, !camDriveLocked)
  useSelectionGizmoTarget(targetObjRef, targetRef, !targetHidden)

  // 运镜驱动(优先级 -1,赶在 wrapper 的 lookAt 之前):
  // 机位路径非空且 moveMode=path → 机位取路径上行进进度处。
  // 相机始终 lookAt Target 本体;路径为空时自动回退手动,不会出现
  // "相机消失"
  const pathSampleTmp = useRef(new Vector3())
  useFrame(() => {
    const cam = camRef.current
    const camObj = cameraObjRef.current
    if (!cam || !camObj) return
    const tmp = pathSampleTmp.current
    if (
      val(camObj.props.moveMode) === 'path' &&
      samplePathPoint(POS_PATH_KEY, val(posPathMeta.props.progress), tmp)
    ) {
      cam.position.copy(tmp)
    }
    if (targetRef.current) {
      aimRef.current.position.copy(targetRef.current.position)
    }
  }, -1)

  // 视锥线/显示面/瞄准点手柄只在编辑视角出现;镜头视角全屏时人已经在镜头里,直接藏
  // (Target 的可见性走下面 e.mesh 的 visible 属性:镜头视角或软删时都藏)
  useEffect(() => registerEditorOnly(frustum), [frustum])
  useEffect(() => registerEditorOnly(frustumFill), [frustumFill])
  useEffect(() => registerEditorOnly(targetRef.current), [])
  useEffect(() => {
    frustum.visible = !makeDefault
    frustumFill.visible = !makeDefault
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

  // 右键相机 = 选中 + 弹机位路径的菜单,和右键路径线本身弹的是同一个
  // (Target 没有右键菜单:软删走相机面板的开关)
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
        lookAt={tracking ? aimRef : undefined}
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
        visible={!targetHidden && !makeDefault}
        onClick={targetHidden ? undefined : select(targetObjRef)}
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
