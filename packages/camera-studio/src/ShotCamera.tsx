import {PerspectiveCamera, useCurrentSheet} from '@dreamerbird/r3f'
import {getStudioSync, types as t, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {MutableRefObject} from 'react'
import {invalidate, useFrame, useThree} from '@react-three/fiber'
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
import {translate} from '@dreamerbird/studio/i18n'
// 副作用导入:本模块在模块加载时就 translate 属性标签,必须先注册词条,
// 否则入口文件 import 顺序不保险时会把原始 key 烘焙进配置
import './i18n'
import {registerEditorOnly, withEditorOnlyHidden} from './editorOnly'
import {useSelectionGizmoTarget} from './PlacementManager'
import {
  getPathMeta,
  samplePathPoint,
  usePathExists,
  usePathHasPoints,
} from './CameraPath'
import {resolveBoundPathKey} from './pathBinding'
import {getPathsRegistry, readPathEntries, usePathsList} from './pathRegistry'
import {consumeCameraSeed, registerShotCameraObject} from './cameraRegistry'
import {
  resolveAimTarget,
  aimTargetOptions,
  subscribeTargetRegistry,
} from './aimTargets'
import {formatSceneObjectId} from './agent/objectIds'
import {
  registerSceneSheetObject,
  unregisterSceneSheetObject,
} from './agent/runtime/objectRuntime'
import {
  notifyCameraReady,
  rejectCameraMount,
} from './agent/runtime/cameraLifecycle'

/**
 * 场景摄像机(shot camera):独立于编辑主视角的"镜头",取景画面用于
 * 画中画预览和之后的视频导出,对标 Blender 的场景 Camera 对象。
 *
 * - theatre 对象 Shot Camera(位置/旋转/fov 可上时间轴)。朝向不再自带
 *   Target 对象:由面板上的「瞄准目标」下拉(aimTarget 属性)选目标,
 *   目标可解析时相机 lookAt 它,对齐 Blender 的 Track To 约束
 *   (约束的目标槽换成运行时登记表里的锚点/骨骼/模型/相机);
 *   解绑或目标消失时把当前朝向定格进 rotation 属性,画面不跳
 * - 运镜驱动:机位可以切到"沿路径"(相机面板的「绑定路径」下拉选一条
 *   路径,对齐 Blender 的约束跟随),由 CameraPath 的曲线 + 路径对象的
 *   行进进度(0~1,对齐曲线侧的 Evaluation Time)驱动,
 *   进度打关键帧 = 调运镜节奏;路径为空时回退手动,不产生异常画面
 * - 编辑器里的视锥示意:从相机顶点拉 4 条线到固定距离的末端平面,
 *   平面画成半透明色块(自绘 LineSegments + 半透明 Plane,不用
 *   CameraHelper——它无法被 scene.clone() 复制,r3f 快照编辑器克隆
 *   场景时必炸),点线或色块即选中摄像机,挂三轴箭头拖动摆机位;
 *   机位被路径接管时相机箭头不出现
 *   (对齐 Blender 的约束:驱动期间物体拖不动,要挪就挪路径/进度)
 * - 画中画:右下角小窗实时渲染镜头取景;切到"镜头视角"时全屏取景
 * - 视锥线/手柄都登记进 editorOnly,画中画与镜头视角渲染时
 *   隐藏,取景画面始终干净
 */

const PIP_WIDTH_FRACTION = 0.28
const PIP_MARGIN_PX = 16
const FRUSTUM_COLOR = 0x6fb7ff
/** 视锥示意线的末端距离(示意用,与相机实际 far 无关;0.75 = 早期 3 的四分之一) */
const FRUSTUM_DISPLAY_LENGTH = 0.75
/** 末端平面的不透明度 */
const FRUSTUM_FILL_OPACITY = 0.12
/** 选中高亮色:与锚点同色(Blender 式选中橙),选中时整套视锥换色 */
const FRUSTUM_HIGHLIGHT = 0xffb020
/**
 * 尾部内缩比例:机位射向远端矩形角点的 4 根线,从机位前方「视锥长度
 * × 该比例」处才开始画,4 根线不再在机位精确交汇成亮点,尾部更干净
 */
const FRUSTUM_TAIL_INSET = 0.125

/**
 * 运镜驱动属性,挂在 Shot Camera 对象上(模块级常量:
 * sheet.object 重复调用要求配置 deep-equal,函数按引用比,
 * 每次 render 新建会在热更新后炸"called twice with different config")。
 *
 * 分工对齐 Blender 的 Follow Path:**绑哪条路径归相机**(pathKey 属性,
 * 面板下拉选,选了即生效、清空即解绑,position 属性被忽略),**行进进度
 * 归路径**(绑定路径对象的 progress 属性,打关键帧 = 调运镜节奏;
 * 对齐曲线侧的 Evaluation Time)。路径被删回退手动(机位定格当前,
 * 对齐 Blender 约束目标消失),不产生异常画面。
 * 朝向绑定归「瞄准目标」下拉(aimTarget 属性):选「无」或目标消失
 * = 解除朝向绑定(对齐 Blender 关掉 Track To 约束):解绑瞬间把当前
 * 朝向定格进 rotation 属性,画面不跳。
 */

/**
 * 「绑定路径」下拉的动态选项:pathKey → 显示名。选项函数由 studio 在
 * 编辑器渲染/校验时调用(不在 React 上下文里),经 dropdownSheet 拿
 * 当前 sheet 读注册表;注册表对象还没建好时退化为只有「手动」一项。
 */
let dropdownSheet: ISheet | null = null

function pathBindingOptions(): {[key: string]: string} {
  // 选项函数每次读取都会调,经 t() 取词:语言切换后面板重渲染即生效
  const options: {[key: string]: string} = {
    '': translate('pg.props.pathManual'),
  }
  if (!dropdownSheet) return options
  try {
    for (const entry of readPathEntries(getPathsRegistry(dropdownSheet))) {
      options[entry.pathKey] = entry.pathKey
    }
  } catch {
    // 注册表对象尚未创建:只有手动项
  }
  return options
}

/**
 * 运镜驱动属性,挂在 Shot Camera 对象上(模块级常量:
 * sheet.object 重复调用要求配置 deep-equal,函数按引用比,
 * 每次 render 新建会在热更新后炸"called twice with different config")。
 *
 * pathKey 是绑定的单一直径:下拉选项动态来自注册表(见
 * pathBindingOptions),选「手动」= 解绑。moveMode 是双属性时代的
 * 历史属性,隐藏保留只为兼容已持久化的状态值,不再显示也不再读写。
 *
 * label 用函数形式(() => translate(...)):studio 属性面板每次渲染
 * 都会现调(resolvePropLabel),所以语言切换后这两个标签跟着热改,
 * 不再需要刷新页面。箭头函数在模块级定义,引用稳定,满足 deep-equal。
 * moveMode 已 hidden(双属性时代遗留),不再显示,硬编码留着无碍。
 */
const shotCameraAdditionalProps = {
  // 旧「朝向绑定」开关已并入 aimTarget 下拉(选「无」= 解绑):
  // 属性隐藏保留只为兼容已持久化的状态值,不再显示也不再读写
  trackTarget: t.boolean(true, {
    label: () => translate('pg.props.trackTarget'),
    hidden: true,
  }),
  aimTarget: t.stringLiteral('', aimTargetOptions, {
    label: () => translate('pg.props.aimTarget'),
    as: 'menu',
  }),
  moveMode: t.stringLiteral(
    'manual',
    {manual: '手动', path: '路径'},
    {label: '机位驱动', hidden: true},
  ),
  pathKey: t.stringLiteral('', pathBindingOptions, {
    label: () => translate('pg.props.pathKey'),
    as: 'menu',
  }),
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

/**
 * "上方"指示三角(对齐 Blender 相机 gizmo):末端矩形上边中点向上
 * 一根实心三角,随视锥一起按 fov/aspect 缩放、跟相机翻滚转动,
 * 一眼看出哪边是镜头的上。单位几何:底边宽 1、高 1,底边中点在原点。
 */
function makeUpTriangle(): Mesh {
  const geo = new BufferGeometry()
  geo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]), 3),
  )
  const tri = new Mesh(
    geo,
    new MeshBasicMaterial({
      color: FRUSTUM_COLOR,
      side: DoubleSide,
      toneMapped: false,
    }),
  )
  tri.frustumCulled = false
  return tri
}

/** 按相机当前 fov/aspect 重写视锥顶点、显示面尺寸和上方三角(挂在相机节点下,用视空间坐标) */
function updateFrustum(
  lines: LineSegments,
  fill: Mesh,
  up: Mesh,
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
    // 尾部内缩:起点从机位沿角点方向前移视锥长度的 FRUSTUM_TAIL_INSET,
    // 4 根线起点错开,不再交汇成亮点
    seg(
      [
        corners[i][0] * FRUSTUM_TAIL_INSET,
        corners[i][1] * FRUSTUM_TAIL_INSET,
        corners[i][2] * FRUSTUM_TAIL_INSET,
      ],
      corners[i],
    )
  }
  attr.needsUpdate = true
  fill.scale.set(2 * w, 2 * h, 1)
  // 上方三角:宽取矩形宽的一半,高 = 宽的一半(高宽比 1:2),
  // 底边与矩形上边之间留 1/8 底宽的间距
  up.position.set(0, h + w * 0.125, z)
  up.scale.set(w, w * 0.5, 1)
}

/** 响应式读对象的某个标量属性(值没变就返回原引用,不触发重渲染) */
export function useObjPropScalar<T>(
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
  cameraKey,
  isActive,
  shotView,
  pipVisible,
  pipBottom,
  cameraObjRef,
  onCameraContextMenu,
}: {
  cameraKey: string
  /** 活动相机:画中画/镜头视角全屏/导出都只对它生效 */
  isActive: boolean
  /** 镜头视角全屏中(此时非活动相机的视锥也全部隐藏) */
  shotView: boolean
  /** 画中画开关(顶栏按钮);只影响编辑视角的右下角小窗,镜头全屏视角不受它管 */
  pipVisible: boolean
  /** 画中画底部留白(px,DOM 边框层同源):悬在时间轴面板上方 */
  pipBottom: number
  cameraObjRef: MutableRefObject<ISheetObject<any> | undefined>
  /** 右键相机:弹出相机菜单 */
  onCameraContextMenu?: (x: number, y: number) => void
}) {
  // true = 镜头视角全屏(主相机让位);false = 编辑视角,右下角画中画
  const makeDefault = shotView && isActive
  const camRef = useRef<PerspectiveCameraImpl>(null!)
  // 登记 three 相机对象,供锚点父级绑定的 camera: 解析
  useEffect(() => {
    registerShotCameraObject(cameraKey, camRef.current)
    return () => registerShotCameraObject(cameraKey, null)
  }, [cameraKey])
  // 瞄准代理:wrapper 的 lookAt 每帧读它的位置。瞄准目标(aimTarget)
  // 解析出的运行时对象每帧先把世界位置写进代理,wrapper 优先级 0 的
  // lookAt 读到的就是本帧的值,朝向不晚一帧
  const aimRef = useRef<Object3D>(new Object3D())
  const frustum = useMemo(makeFrustumLines, [])
  const frustumFill = useMemo(makeFrustumFill, [])
  const upTriangle = useMemo(makeUpTriangle, [])

  // Agent 运行时登记(2026-10-17,Task 10):objRef 填充即「相机
  // SheetObject 已挂载」信号,cameras.create 的 resolver 复核与
  // scene/objects 查询都读这份登记;清空/卸载时按 id + 同一对象清理,
  // 防过期 cleanup 误删新代次。editable 的 objRef 支持回调形式
  // (与 Anchors/PlacedModelCore 同款)
  const setCameraObjRef = useCallback(
    (obj: ISheetObject<any> | null) => {
      const id = formatSceneObjectId('camera', cameraKey)
      const prev = cameraObjRef.current
      cameraObjRef.current = obj ?? undefined
      if (obj) {
        registerSceneSheetObject(id, obj)
      } else {
        unregisterSceneSheetObject(id, prev)
      }
    },
    [cameraKey, cameraObjRef],
  )

  // 新相机落地即取景:添加时从导演视角捕获的种子(机位/朝向),
  // 挂载后消费一次——此后相机数据归面板/拖拽/时间轴管,种子不再介入。
  // 结束时通知 Agent 挂载等待者(cameras.create 的 completion:mounted);
  // 没有 seed 的恢复对象同样通知,不重复写值
  useLayoutEffect(() => {
    const seed = consumeCameraSeed(cameraKey)
    const camObj = cameraObjRef.current
    if (seed && camObj) {
      const studio = getStudioSync()
      if (studio) {
        const scrub = studio.scrub()
        scrub.capture(({set}) => {
          set(camObj.props.position, seed.position)
          set(camObj.props.rotation, seed.rotation)
        })
        scrub.commit()
      }
    }
    // cameraObjRef 是稳定引用;子组件(editable)的 layout
    // effect 先跑,到这里 objRef 已填好(Agent 登记也在那完成)
    notifyCameraReady(cameraKey)
  }, [cameraKey])

  // 卸载即清空 App 侧的对象引用:editable 只填不清,注册表移除相机后
  // ref 若仍指向已删除的对象,播种/再删除等逻辑会读到失效数据。
  // 同时按 id + 同一对象清 Agent 登记;挂载等待未兑现即卸载时拒绝,
  // cameras.create 的等待方不悬挂(UI 路径无 waiter,no-op)
  useEffect(
    () => () => {
      const prev = cameraObjRef.current
      cameraObjRef.current = undefined
      unregisterSceneSheetObject(formatSceneObjectId('camera', cameraKey), prev)
      rejectCameraMount(
        cameraKey,
        new Error(`相机挂载未完成即卸载: ${cameraKey}`),
      )
    },
    [cameraObjRef, cameraKey],
  )

  // 驱动锁(对齐 Blender 的约束语义):机位被路径接管期间,
  // 相机拖了也不生效,干脆不登记选中 gizmo——箭头和 G 抓取
  // 都不出现,从源头消灭"拖了没反应、数据还悄悄岔开"的假动作。
  // 空路径驱动自动回退手动,不锁
  const sheet = useCurrentSheet()!
  // 「绑定路径」下拉的选项函数在面板渲染时调用(非 React 上下文),
  // 把当前 sheet 喂给模块级 pathBindingOptions
  useEffect(() => {
    dropdownSheet = sheet
  }, [sheet])
  // 绑定解析:pathKey 非空且在册 = 绑定生效;进度仍在路径对象上(共享进度)
  const paths = usePathsList(sheet)
  const registeredKeys = useMemo(() => paths.map((e) => e.pathKey), [paths])
  const camPathKey = useObjPropScalar<string>(cameraObjRef, 'pathKey', '')
  const boundKey = resolveBoundPathKey(camPathKey, registeredKeys)
  // boundKey 为 null 时用 '' 探测(getObject('') 恒不存在,不创建)
  const boundPathExists = usePathExists(sheet, boundKey ?? '')
  const boundHasPoints = usePathHasPoints(sheet, boundKey ?? '')
  // getPathMeta 会顺手创建不存在的对象,只有探测到存在才取
  const boundMeta = useMemo(
    () => (boundKey && boundPathExists ? getPathMeta(sheet, boundKey) : null),
    [sheet, boundKey, boundPathExists],
  )
  const camDriveLocked = boundKey !== null && boundHasPoints

  // 帧驱动的机位镜像:useFrame 每次把相机驱动到路径点时就同步一份到
  // 这里。看护/解绑的"定格当前机位"读它,而不是去读 THREE 相机本体
  const drivenPosRef = useRef(new Vector3())
  const drivenPosValidRef = useRef(false)
  // 换绑到另一条路径后,旧路径攒下的镜像作废,等下一次帧驱动写入——
  // 不然换绑瞬间路径被对端删掉,定格会拿上一条路径的旧机位(复审 minor)。
  // 只在换绑/绑定时作废:失效(boundKey→null)时看护紧接着就要读它定格
  useEffect(() => {
    if (boundKey !== null) drivenPosValidRef.current = false
  }, [boundKey])

  // 解绑/失效统一看护:boundKey 由有变无(下拉选「手动」、绑定路径被删)
  // → 过期 position 属性马上会被包装器重应用,相机跳回绑定前位置——
  // 先把当前驱动机位定格进 position(对齐 Blender:约束解除,物体保持
  // 当前变换),同时清掉 pathKey(失效时可能留着已删路径的死 key)。
  // 本地路径删除已在 removePathFromRegistry 的同一个 scrub 里定格+清
  // 绑定(App 的 removePath),这里检测到无需再写就直接跳过,不产生
  // 多余撤销步。空路径(没控制点)不算失效,维持绑定。
  // 定格取 drivenPosRef(帧驱动每帧镜像的驱动机位),不读 cam.position:
  // 解绑引发的 theatre 值变化可能已让包装器重应用过期属性、或组件
  // 重挂载出了新相机,此刻 cam.position 不一定是画面机位(实测竞态:
  // 同一删除两次运行一次定格一次跳变)
  const prevBoundKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevBoundKeyRef.current
    prevBoundKeyRef.current = boundKey
    if (prev === null || boundKey !== null) return
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!obj || !studio) return
    const frozen = drivenPosValidRef.current
      ? drivenPosRef.current
      : camRef.current?.position
    const cur = val(obj.props.position) as
      | {x: number; y: number; z: number}
      | undefined
    const pathKey = (val(obj.props.pathKey) as string | undefined) ?? ''
    const alreadyFrozen =
      !!frozen &&
      !!cur &&
      cur.x === frozen.x &&
      cur.y === frozen.y &&
      cur.z === frozen.z
    if (alreadyFrozen && pathKey === '') return
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      if (frozen && !alreadyFrozen)
        set(obj.props.position, {x: frozen.x, y: frozen.y, z: frozen.z})
      if (pathKey !== '') set(obj.props.pathKey, '')
    })
    scrub.commit()
  }, [boundKey, cameraObjRef])

  // 朝向绑定:aimTarget 下拉选目标(对齐 Blender Track To 的目标槽)。
  // tracking = 目标存在且可解析;目标被删/选「无」→ 定格当前朝向进
  // rotation 属性,画面不跳(对齐 Blender 约束失效)
  const aimTargetId = useObjPropScalar<string>(cameraObjRef, 'aimTarget', '')
  const aimObj = aimTargetId ? resolveAimTarget(aimTargetId) : null
  const tracking = aimObj !== null
  // 目标登记表变更订阅:四条登记路径——独立锚点(registerAnchorObject)、
  // 拍摄相机(registerShotCameraObject)、骨骼锚点(registerBoneAnchors/
  // unregisterBoneAnchors)、放置实例(registerPlacedInstance/
  // unregisterPlacedInstance)——写表后都经 notifyTargetRegistryChange
  // 广播:持久态 aimTarget 指向的目标在目标挂载登记/注销的瞬间,tracking
  // (渲染期解析)立即翻正,不等到无关重渲染;目标被删同理即时触发下面
  // 的定格看护(规格§4 回退自由朝向)
  const [, bumpTargetRegistry] = useState(0)
  useEffect(
    () => subscribeTargetRegistry(() => bumpTargetRegistry((n) => n + 1)),
    [],
  )
  const prevTrackingRef = useRef<boolean | null>(null)
  const capturePosTmp = useRef(new Vector3())
  useEffect(() => {
    const prev = prevTrackingRef.current
    prevTrackingRef.current = tracking
    // prev=null 是挂载首次跑(持久态恢复):rotation 本来就是对的,跳过
    if (prev !== true || tracking) return
    const cam = camRef.current
    const obj = cameraObjRef.current
    const studio = getStudioSync()
    if (!cam || !obj || !studio) return
    // 此刻包装器刚全量应用过属性、帧驱动还没跑:机位被路径接管时
    // cam.position 是过期的 position 属性值,不是画面里的真实机位——
    // 真实机位用路径采样重算;瞄准方向读 aimRef(每帧镜像目标位置,
    // 此刻存的是最后画面里的目标位置)
    const sampled = capturePosTmp.current
    const from =
      boundMeta &&
      samplePathPoint(boundKey!, val(boundMeta.props.progress), sampled)
        ? sampled
        : cam.position
    const m = new Matrix4().lookAt(from, aimRef.current.position, cam.up)
    const e = new Euler().setFromRotationMatrix(m, 'XYZ')
    // 同值守卫(与解绑定格的 alreadyFrozen 同款):cameras.setAimTarget
    // 命令解除瞄准时已把朝向定格折进写 aimTarget 的同一事务,持久值==
    // 此处换算结果,原样重写会多出一个同值撤销步骤(撤销陷阱)——跳过提交
    const persisted = val(obj.props.rotation) as
      | {x: number; y: number; z: number}
      | undefined
    const sameRotation =
      !!persisted &&
      Math.abs(persisted.x - e.x) < 1e-6 &&
      Math.abs(persisted.y - e.y) < 1e-6 &&
      Math.abs(persisted.z - e.z) < 1e-6
    if (sameRotation) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => set(obj.props.rotation, {x: e.x, y: e.y, z: e.z}))
    scrub.commit()
  }, [tracking, cameraObjRef, boundKey, boundMeta])

  // 选中后挂三轴移动箭头:摄像机本体可拖(机位被路径接管时
  // 相机除外,见上)。视锥有自己的选中高亮(整套变橙),不再画包围盒
  useSelectionGizmoTarget(cameraObjRef, camRef, !camDriveLocked, {
    boxHighlight: false,
  })

  // 运镜驱动(优先级 -1,赶在 wrapper 的 lookAt 之前):
  // 机位路径非空且 moveMode=path → 机位取路径上行进进度处。
  // 瞄准目标可解析时每帧把它的世界位置写进代理;目标为空时
  // 自动回退手动朝向(rotation 属性),不会出现"相机消失"
  const pathSampleTmp = useRef(new Vector3())
  useFrame(() => {
    const cam = camRef.current
    const camObj = cameraObjRef.current
    if (!cam || !camObj) return
    const tmp = pathSampleTmp.current
    if (
      boundMeta &&
      samplePathPoint(boundKey!, val(boundMeta.props.progress), tmp)
    ) {
      cam.position.copy(tmp)
      drivenPosRef.current.copy(tmp)
      drivenPosValidRef.current = true
    }
    // useFrame 回调里读外层渲染作用域的 aimTargetId——它在帧间变化会
    // 触发重渲染,闭包是新的,安全
    const aimObj = aimTargetId ? resolveAimTarget(aimTargetId) : null
    if (aimObj) aimObj.getWorldPosition(aimRef.current.position)
  }, -1)

  // 视锥线/显示面只在编辑视角出现;镜头视角全屏时人已经在镜头里,直接藏
  useEffect(() => registerEditorOnly(frustum), [frustum])
  useEffect(() => registerEditorOnly(frustumFill), [frustumFill])
  useEffect(() => registerEditorOnly(upTriangle), [upTriangle])
  useEffect(() => {
    frustum.visible = !shotView
    frustumFill.visible = !shotView
    upTriangle.visible = !shotView
  }, [shotView, frustum, frustumFill, upTriangle])

  // 选中高亮:视锥三件套整套换橙色,对齐锚点色与 Blender 选中惯例。
  // studio 选中变化驱动(值不变 setState 自动跳过,无关切换不重渲染);
  // demand 帧模式下换色不重画,手动 invalidate 补一帧
  const [selected, setSelected] = useState(false)
  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    const sync = () =>
      setSelected(
        (studio.selection as unknown[]).includes(cameraObjRef.current),
      )
    sync()
    return studio.onSelectionChange(sync)
  }, [cameraObjRef])
  useEffect(() => {
    const color = selected ? FRUSTUM_HIGHLIGHT : FRUSTUM_COLOR
    ;(frustum.material as LineBasicMaterial).color.set(color)
    ;(frustumFill.material as MeshBasicMaterial).color.set(color)
    ;(upTriangle.material as MeshBasicMaterial).color.set(color)
    invalidate()
  }, [selected, frustum, frustumFill, upTriangle])

  useFrame(() => {
    if (camRef.current && frustum.visible) {
      updateFrustum(frustum, frustumFill, upTriangle, camRef.current)
    }
  })

  // 调试/自动化验证挂钩:浏览器里直接读 three 相机本体(只写活动相机的)
  useEffect(() => {
    if (isActive) (window as any).__shotCam3 = camRef.current
  }, [isActive])

  // 点视锥线 = 选中摄像机
  const select =
    (objRef: MutableRefObject<ISheetObject<any> | undefined>) =>
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      const studio = getStudioSync()
      if (studio && objRef.current) {
        studio.setSelection([objRef.current])
      }
    }

  // 右键相机 = 选中 + 弹出相机菜单
  const contextMenu =
    (objRef: MutableRefObject<ISheetObject<any> | undefined>) =>
    (event: ThreeEvent<MouseEvent>) => {
      if (!onCameraContextMenu) return
      event.stopPropagation()
      event.nativeEvent.preventDefault()
      const studio = getStudioSync()
      if (studio && objRef.current) {
        studio.setSelection([objRef.current])
      }
      onCameraContextMenu(event.nativeEvent.clientX, event.nativeEvent.clientY)
    }

  return (
    <>
      <PerspectiveCamera
        theatreKey={cameraKey}
        objRef={setCameraObjRef}
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
          onContextMenu={contextMenu(cameraObjRef)}
        />
        <primitive
          object={frustumFill}
          onClick={select(cameraObjRef)}
          onContextMenu={contextMenu(cameraObjRef)}
        />
        <primitive
          object={upTriangle}
          onClick={select(cameraObjRef)}
          onContextMenu={contextMenu(cameraObjRef)}
        />
      </PerspectiveCamera>
      {isActive && (
        <ShotCameraRenderer
          camRef={camRef}
          pip={!makeDefault}
          pipVisible={pipVisible}
          pipBottom={pipBottom}
        />
      )}
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
  pipVisible,
  pipBottom,
}: {
  camRef: MutableRefObject<PerspectiveCameraImpl>
  pip: boolean
  pipVisible: boolean
  pipBottom: number
}) {
  // frameloop="demand":切换镜头视角/画中画只是 React 状态变化,
  // 不触发新帧的话画布上会留着上一帧(全屏取景的右下角)当"画中画"
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    // 开关切换也要 invalidate:关掉时触发一帧重画,把残留在画面角落的
    // 最后一帧小窗清掉(demand 模式下不会自动重画)
    invalidate()
  }, [pip, pipVisible, invalidate])

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

    // 画中画被顶栏开关关掉了:这一帧不叠小窗(镜头全屏视角不受开关管)
    if (!pipVisible) return

    const pipW = Math.round(w * PIP_WIDTH_FRACTION)
    const pipH = Math.round((pipW * 9) / 16)
    const x = w - pipW - PIP_MARGIN_PX
    // gl viewport 原点在左下角;底部留白与 DOM 边框层同源(悬在时间轴上方)
    const y = pipBottom

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
