import {useCurrentSheet} from '@dreamerbird/r3f'
import {getStudioSync, onChange, types as t, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import getStudioInternal from '@dreamerbird/studio/getStudio'
import getDeep from '@dreamerbird/utils/getDeep'
import type {IScrub, ISheet, ISheetObject} from '@dreamerbird/core'
import type {SheetObjectActionsConfig} from '@dreamerbird/core/types/public'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {TransformControls} from '@react-three/drei'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import type {CurvePath, Object3D} from 'three'
import {registerEditorOnly} from './editorOnly'
import {useModalGrab} from './modalGrab'
import {
  isSelectSuppressed,
  suppressSelectBriefly,
  useSelectionGizmoTarget,
} from './PlacementManager'
import {
  buildCurve,
  buildLinePositions,
  composePathMatrix,
  directionArrowMatrices,
  effectiveHandles,
  effectiveUs,
  extendPathPoint,
  IDENTITY_PATH_TRANSFORM,
  nextPointKey,
  parsePathPoints,
  sampleCurve,
  serializePathPoints,
  withDraggedHandle,
  withMovedPoint,
  withMovedU,
  withResetU,
} from './pathModel'
import type {PathPointEntry, PathTransform, Vec3Like} from './pathModel'

/**
 * 运镜路径:一条可编辑的空间曲线(机位用,同一个组件将来可复用)。
 * 模型对齐 Blender 的曲线对象:
 *
 * - 路径对象 = 变换(位置/旋转/缩放)+ 曲线(points:几何底账,隐藏)
 *   + 行进(progress:0~1 行进进度,可见可打关键帧)三部分——对齐
 *   Blender:物体模式动变换(整体移动/旋转/缩放),曲线数据里除了几何
 *   还有 Path Animation(Evaluation Time),行进节奏的家是曲线
 * - 控制点是纯数据,存在 `${metaKey}` 对象的 points 文本属性里(JSON 底账,
 *   勿手改),坐标是相对路径原点的局部坐标——不是 theatre 对象,不进大纲、
 *   不上时间轴,编辑全部在视口里;世界位置 = 变换矩阵 × 局部坐标
 * - 平时(对象模式)显示路径线(实线,普通蓝色);方向箭头(沿线小圆锥,
 *   指向行进进度 0→1 的方向,Blender 曲线方向刻度的对应物)只在编辑
 *   模式出现。选中路径(点线/大纲)线变黄、路径原点出现小黄标,挂整体
 *   移动箭头、G 整体抓取(改的是路径的变换属性,点数据不动);右键路径线
 *   或按 Tab 进入编辑模式:线变亮黄、控制点圆点出现,可点选、挂三轴箭头
 *   沿轴精拖,
 *   或按 G 进入 Blender 式模态抓取:点跟随鼠标(视图平面),X/Y/Z 锁轴,
 *   左键/回车确认,右键/Esc 取消
 * - 选中的控制点显示贝塞尔手柄(小圆点+连线):按住小圆点直接拖;
 *   默认自动(平滑穿过),拖动后转手动,两手柄方向共线(Blender 的"对齐");
 *   App 层另有数值浮条(显示的是局部坐标);点级增删在编辑浮条
 *   (PathEditBar:加点/删除选中点),不进全局菜单。
 *   控制点/手柄都是屏幕恒定大小的实心标记(深度测试关掉、画在最上层),
 *   对齐 Blender 的屏幕空间编辑 UI:任何缩放级别下同样清晰、同样好点
 * - 拖动/增删都是一次 scrub 提交 = 一步撤销;镜头视角下整体隐藏
 */

export const POS_PATH_KEY = 'Pos Path'

/** 路径的显示名(目前只有机位路径一条;菜单/浮条里展示用) */
export function pathLabel(metaKey: string): string {
  return '机位路径'
}

/** 路径对象自己的名字(大纲里显示的那个,如 "Pos Path"):取名单键
 *  的最后一段。给"选目标"类的下拉用——选项显示对象真名,不是功能标签 */
export function pathObjectName(metaKey: string): string {
  return metaKey.split('/').pop()?.trim() || metaKey
}

/** 路径线折线的顶点缓冲容量(段数多了会自动降低每段细分,不会溢出) */
const LINE_BUFFER_VERTS = 256
/** 控制点圆点的屏幕尺寸(px,恒定不随缩放——Blender 的屏幕空间编辑标记) */
const POINT_SIZE_PX = 13
/** 手柄圆点的屏幕直径(px,同上) */
const HANDLE_SIZE_PX = 10

// ---------------------------------------------------------------------------
// 名单元数据对象(theatre)

// t.string/t.number 每次调用生成新配置对象;sheet.object 对同一个 key 的
// 重复调用要求配置 deep-equal,函数按引用比——和 PlacementManager 的
// fileConfigCache 同一个原因,配置按 metaKey 缓存成同一个引用
type PathMetaConfig = {
  points: ReturnType<typeof t.string>
  progress: ReturnType<typeof t.number>
  position: ReturnType<typeof t.compound>
  rotation: ReturnType<typeof t.compound>
  scale: ReturnType<typeof t.compound>
}
const metaConfigCache = new Map<string, PathMetaConfig>()

/**
 * 路径对象 = 变换(位置/旋转/缩放,对齐 Blender 物体模式的对象变换,
 * 可打关键帧 = 整条路径的动画)+ 曲线(points:几何底账,隐藏)
 * + 行进(progress:0~1 行进进度,对齐曲线侧的 Evaluation Time,
 * 行进节奏的家是曲线,不是跟随者)三部分。
 *
 * 控制点是相对路径原点的局部坐标;默认变换是单位阵,老场景的点
 * (原本就是世界坐标)无缝过渡。
 */
export function getPathMeta(sheet: ISheet, metaKey: string) {
  let config = metaConfigCache.get(metaKey)
  if (!config) {
    // hidden: 纯数据底账不在属性面板出现(编辑全在视口/菜单,勿手改)
    config = {
      points: t.string('[]', {label: '控制点名单(JSON)', hidden: true}),
      progress: t.number(0, {range: [0, 1], label: '行进进度'}),
      position: t.compound(
        {x: t.number(0), y: t.number(0), z: t.number(0)},
        {label: '位置'},
      ),
      rotation: t.compound(
        {x: t.number(0), y: t.number(0), z: t.number(0)},
        {label: '旋转(弧度)'},
      ),
      scale: t.compound(
        {x: t.number(1), y: t.number(1), z: t.number(1)},
        {label: '缩放'},
      ),
    }
    metaConfigCache.set(metaKey, config)
  }
  const meta = sheet.object(metaKey, config)
  // 调试/自动化验证挂钩:page 上下文拿不到 sheet.object(配置校验),
  // 名单对象从这里直接读(同 __cameraShot 的用法)
  ;((window as any).__cameraPathMeta ??= {})[metaKey] = meta
  return meta
}

/**
 * 给路径对象挂面板动作(属性后的按钮区,core 的 __actions__ 机制)。
 * 重复调用同 key 同 config 只更新 actions;actions 传 {} = 清空。
 * 调用前必须保证 getPathMeta 跑过(metaConfigCache 里有 config)。
 */
export function setPathPanelActions(
  sheet: ISheet,
  metaKey: string,
  actions: SheetObjectActionsConfig,
) {
  const config = metaConfigCache.get(metaKey)
  if (!config) return
  sheet.object(metaKey, config, {
    __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION:
      actions,
  })
}

/** 响应式读名单:meta 为 null(对象不存在)时按空名单算 */
function usePathPointEntries(
  meta: ISheetObject<{points: string}> | null,
): PathPointEntry[] {
  const [entries, setEntries] = useState<PathPointEntry[]>(() =>
    meta ? parsePathPoints(meta.value.points) : [],
  )
  useEffect(() => {
    if (!meta) {
      setEntries([])
      return
    }
    setEntries(parsePathPoints(meta.value.points))
    return meta.onValuesChange(() =>
      setEntries(parsePathPoints(meta.value.points)),
    )
  }, [meta])
  return entries
}

/**
 * 路径对象是否存在(只探测,不创建):走内部对象表——sheet.object
 * 查不存在就会顺手创建,那是"没点就不出现"要躲开的
 */
export function pathExists(sheet: ISheet, metaKey: string): boolean {
  return (privateAPI(sheet) as any).getObject(metaKey) != null
}

/** 响应式存在性:订阅内部对象表,任何途径增删对象都会触发。
 *  返回渲染期直读的实时值(state 只负责触发重渲染)——
 *  key 切换时不存在"上一 key 的过期存在性"窗口 */
export function usePathExists(sheet: ISheet, metaKey: string): boolean {
  const [, setProbe] = useState(0)
  useEffect(() => {
    setProbe((n) => n + 1)
    return onChange((privateAPI(sheet) as any).objectsP, () =>
      setProbe((n) => n + 1),
    )
  }, [sheet, metaKey])
  return pathExists(sheet, metaKey)
}

/**
 * 响应式:路径是否有控制点。对象不存在(未注册/已删除)时算没有,
 * 绝不顺手创建——创建只发生在注册表加行后的组件挂载。
 * 空路径时驱动自动回退手动(见 ShotCamera),相机仍可拖;
 * ShotCamera 用它决定要不要锁掉移动箭头
 */
export function usePathHasPoints(sheet: ISheet, metaKey: string): boolean {
  const exists = usePathExists(sheet, metaKey)
  const meta = useMemo(
    () => (exists ? getPathMeta(sheet, metaKey) : null),
    [sheet, metaKey, exists],
  )
  return usePathPointEntries(meta).length > 0
}

/**
 * 自愈:points 必须是静态纯数据。属性面板上每个属性都有打关键帧的菱形,
 * 误点一下(或撤销把它变回去)就会把 points 变成序列轨道——之后读写全部
 * 随播放头漂移,增删/拖动写进去的都是关键帧,表现为"改了又回来/删不掉"。
 * 这里监听轨道表,发现 points 被上帧就立刻摊平回静态(取当前播放头的值,
 * 同 studio 右键菜单的 Make static;不可撤销的只是不进撤销栈,照常落盘)。
 *
 * 必须等 studio.initialized(持久态恢复完成)再开始监听:恢复过程中历史
 * 状态是半成品(轨道可能已在、后面的静态覆盖还没回放到),这时摊平会把
 * 过期值重新固化成最新静态值,名单"清空又复活"就是这么来的。
 */
function useKeepPointsPropStatic(meta: ISheetObject<{points: string}>) {
  useEffect(() => {
    const internal = privateAPI(meta)
    let cancelled = false
    let untap: (() => void) | undefined
    void getStudioInternal().initialized.then(() => {
      if (cancelled) return
      untap = onChange(
        internal.template.getMapOfValidSequenceTracks_forStudio(),
        (tracks) => {
          if (typeof getDeep(tracks, ['points']) !== 'string') return
          getStudioInternal().transaction(({stateEditors}) => {
            stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsStatic(
              {
                ...internal.address,
                pathToProp: ['points'],
                value: meta.value.points,
              },
            )
          }, false)
        },
      )
    })
    return () => {
      cancelled = true
      untap?.()
    }
  }, [meta])
}

// ---------------------------------------------------------------------------
// 采样登记表:metaKey → 最新名单 + 曲线 + 进度锚点 + 整体变换矩阵(名单
// 变化时重建曲线,弧长缓存随曲线失效;矩阵随变换属性值变化原地更新)

type RegisteredPath = {
  entries: PathPointEntry[]
  curve: CurvePath<Vector3> | null
  us: number[]
  /** 局部→世界矩阵(路径对象的位置/旋转/缩放组合;变换上时间轴也走这里) */
  matrix: Matrix4
}

const pathRegistry = new Map<string, RegisteredPath>()

/** 读路径对象当前的变换属性(默认值兜底:对象还没持久化过时也是单位阵) */
function readPathTransform(meta: ISheetObject<any>): PathTransform {
  return {
    position: (val(meta.props.position) as Vec3Like | undefined) ?? {
      ...IDENTITY_PATH_TRANSFORM.position,
    },
    rotation: (val(meta.props.rotation) as Vec3Like | undefined) ?? {
      ...IDENTITY_PATH_TRANSFORM.rotation,
    },
    scale: (val(meta.props.scale) as Vec3Like | undefined) ?? {
      ...IDENTITY_PATH_TRANSFORM.scale,
    },
  }
}

/**
 * 按进度在路径上取点(世界坐标):锚点分段取局部点(进度落在哪两个点的
 * 锚点之间,就在那段贝塞尔里按弧长取点;锚点全自动时 = 全程弧长等比),
 * 再乘路径的整体变换矩阵。路径为空返回 false,调用方回退到手动驱动;
 * 单点路径任何进度都取那个点。
 */
export function samplePathPoint(
  metaKey: string,
  u: number,
  out: Vector3,
): boolean {
  const reg = pathRegistry.get(metaKey)
  if (!reg || reg.entries.length === 0) return false
  if (!reg.curve) {
    const p = reg.entries[0]!.position
    out.set(p.x, p.y, p.z)
  } else {
    sampleCurve(reg.curve, reg.us, u, out)
  }
  out.applyMatrix4(reg.matrix)
  return true
}

// ---------------------------------------------------------------------------
// 加点/删点(工具栏按钮调;一次 scrub 提交 = 一步撤销)

/**
 * 加一个控制点:路径为空时用 seed 播种(机位路径=绕目标的弧),
 * 否则沿最后一段方向延伸。seed 为空且名单为空时不动作。
 *
 * seed 给的是世界坐标(从相机/目标的当前位置算出来),控制点存的是
 * 局部坐标——按路径当前变换的逆矩阵换算;变换是单位阵时两者相等。
 *
 * onSeeded:路径从无到有(播种)时,在同一次提交里顺带写入(比如
 * 自动把驱动切到"沿路径"——Blender 的约束加上即生效,不存在
 * "路径建好了却还停在手动"的中间态)。撤销一次 = 点和模式一起回退
 */
export function addPathPoint(
  sheet: ISheet,
  metaKey: string,
  seed: Vec3Like[] | undefined,
  onSeeded?: (set: (prop: any, value: any) => void) => void,
) {
  const studio = getStudioSync()
  if (!studio) return
  const meta = getPathMeta(sheet, metaKey)
  const list = parsePathPoints(meta.value.points)
  const seeded = list.length === 0
  let next: PathPointEntry[]
  if (seeded) {
    if (!seed || seed.length === 0) return
    const inv = pathRegistry.get(metaKey)?.matrix.clone().invert()
    next = seed.map((world, i) => {
      const local = inv
        ? new Vector3(world.x, world.y, world.z).applyMatrix4(inv)
        : null
      return {
        key: `P${i + 1}`,
        position: local
          ? {x: local.x, y: local.y, z: local.z}
          : {x: world.x, y: world.y, z: world.z},
      }
    })
  } else {
    next = [...list, {key: nextPointKey(list), position: extendPathPoint(list)}]
  }
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(meta.props.points, serializePathPoints(next))
    if (seeded) onSeeded?.(set)
  })
  scrub.commit()
}

/** 删掉指定控制点。点不在名单里返回 false,调用方提示 */
export function deletePathPoint(
  sheet: ISheet,
  metaKey: string,
  pointKey: string,
): boolean {
  const studio = getStudioSync()
  if (!studio) return false
  const meta = getPathMeta(sheet, metaKey)
  const list = parsePathPoints(meta.value.points)
  const next = list.filter((e) => e.key !== pointKey)
  if (next.length === list.length) return false
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(meta.props.points, serializePathPoints(next)))
  scrub.commit()
  return true
}

/** 直接读一次名单(菜单动作用;不是响应式,组件里要响应式用 usePathHasPoints) */
export function readPathPoints(
  sheet: ISheet,
  metaKey: string,
): PathPointEntry[] {
  return parsePathPoints(getPathMeta(sheet, metaKey).value.points)
}

/**
 * 整条路径平移 delta:改路径对象的位置属性(Blender 物体模式的整体
 * 移动),控制点的局部数据不动。一次 scrub 提交 = 一步撤销
 */
export function translatePath(sheet: ISheet, metaKey: string, delta: Vec3Like) {
  const studio = getStudioSync()
  if (!studio) return
  const meta = getPathMeta(sheet, metaKey)
  const cur = readPathTransform(meta).position
  const scrub = studio.scrub()
  scrub.capture(({set}) =>
    set(meta.props.position, {
      x: cur.x + delta.x,
      y: cur.y + delta.y,
      z: cur.z + delta.z,
    }),
  )
  scrub.commit()
}

// ---------------------------------------------------------------------------
// 场景组件

function makePathLine(): Line {
  const geo = new BufferGeometry()
  geo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(LINE_BUFFER_VERTS * 3), 3),
  )
  const line = new Line(
    geo,
    new LineBasicMaterial({color: 0xffffff, toneMapped: false}),
  )
  // 顶点随名单重写,包围球会重算(Line raycast 粗测依赖它);
  // 渲染剔除与 drawRange 零填充缓冲的包围球不配合,frustumCulled 直接关掉更稳
  line.frustumCulled = false
  return line
}

function makeProgressMarker(): Mesh {
  return new Mesh(
    new SphereGeometry(0.12, 16, 12),
    new MeshBasicMaterial({color: 0xffffff, toneMapped: false}),
  )
}

function makeHandleLine(): Line {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(2 * 3), 3))
  const line = new Line(
    geo,
    // 编辑标记画在场景最上层(Blender 同款:编辑 UI 不被模型挡住)
    new LineBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      depthTest: false,
      transparent: true,
    }),
  )
  line.frustumCulled = false
  line.renderOrder = 19
  return line
}

/** 选中态的线色:亮黄(Blender 的选中高亮),与路径底色无关;原点标记也用这档 */
const SELECTED_LINE_COLOR = new Color(0xffcc33)
/** 编辑态的线色:比选中再亮一档的黄,一眼看出"我在编辑这条路径" */
const EDITING_LINE_COLOR = new Color(0xffcc33).lerp(new Color(0xffffff), 0.45)

/** 方向箭头(Blender 曲线方向刻度的对应物,仅编辑模式显示):小圆锥沿切线
 *  指向行进方向,实例化渲染,名单变化时重铺。比线暗一档(同色系 0.85) */
const ARROW_MAX = 64
const ARROW_RADIUS = 0.07
const ARROW_HEIGHT = 0.22

function makeDirectionArrows(): InstancedMesh {
  const mesh = new InstancedMesh(
    new ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, 10),
    new MeshBasicMaterial({color: 0xffffff, toneMapped: false}),
    ARROW_MAX,
  )
  mesh.count = 0
  mesh.frustumCulled = false
  return mesh
}

/** 路径原点标记(Blender 物体原点圆点的对应物):选中路径时显示,
 *  和整体移动箭头同位置——不然箭头悬在空白处不知道是啥的 */
function makeOriginMarker(): Mesh {
  const mesh = new Mesh(
    new OctahedronGeometry(0.12),
    new MeshBasicMaterial({color: 0xffffff, toneMapped: false}),
  )
  mesh.visible = false
  mesh.frustumCulled = false
  return mesh
}

export function CameraPath({
  metaKey,
  color,
  hidden,
  editing,
  selectedKey,
  onSelectPoint,
  onContextMenu,
  progressOf,
}: {
  metaKey: string
  color: number
  /** true = 镜头视角:路径是调度工具,入镜没意义 */
  hidden: boolean
  /** true = 编辑模式:控制点/手柄出现,可点可拖 */
  editing: boolean
  /** App 管的选中控制点(跨两条路径全局唯一) */
  selectedKey: string | null
  onSelectPoint: (key: string | null) => void
  /** 右键路径线:弹编辑模式菜单 */
  onContextMenu: (metaKey: string, x: number, y: number) => void
  /** 读当前进度(0~1),给进度标记用;来源是 Shot Camera 的进度属性 */
  progressOf: () => number
}) {
  const sheet = useCurrentSheet()!
  const meta = useMemo(() => getPathMeta(sheet, metaKey), [sheet, metaKey])
  // 卸载即脱离:注册表移除(含撤销"添加路径")会卸载本组件;路径对象
  // 不是 editable,不自动脱离,这里兜底。removePathFromRegistry 已显式
  // 脱离过的话,探测到不存在就跳过(detachObject 对不存在的 key 只告警,
  // 但没必要刷那条警告)
  useEffect(
    () => () => {
      if (pathExists(sheet, metaKey)) sheet.detachObject(metaKey)
    },
    [sheet, metaKey],
  )
  const entries = usePathPointEntries(meta)
  useKeepPointsPropStatic(meta)
  const curve = useMemo(() => buildCurve(entries), [entries])
  // 每个点的生效进度锚点(名单/曲线变化时重算,见 pathModel.effectiveUs)
  const us = useMemo(() => effectiveUs(entries, curve), [entries, curve])
  const line = useMemo(makePathLine, [])
  const marker = useMemo(makeProgressMarker, [])
  const handleLineL = useMemo(makeHandleLine, [])
  const handleLineR = useMemo(makeHandleLine, [])
  const arrows = useMemo(makeDirectionArrows, [])
  const originMarker = useMemo(makeOriginMarker, [])
  // 控制点/手柄的场景节点:控制点挂三轴箭头用(纯数据,不是 theatre 对象)
  const pointNodesRef = useRef(new Map<string, Mesh>())
  const handleNodesRef = useRef<{left: Mesh | null; right: Mesh | null}>({
    left: null,
    right: null,
  })
  const scrubRef = useRef<IScrub | undefined>(undefined)
  // Blender 式模态抓取:G 键抓控制点 / 按住手柄圆点直接拖,共用一套
  const {start: startGrab, active: grabActive} = useModalGrab()
  const invalidate = useThree((s) => s.invalidate)

  // 路径整体变换(Blender 物体模式):线/控制点/手柄/进度标记全挂在
  // 这个分组下,组内一律用局部坐标;世界位置由分组的变换算。分组本体
  // 同时是"选中路径 → 整体移动箭头"的附着目标(箭头在路径原点)
  const pathRoot = useMemo(() => new Group(), [])

  // 变换属性(面板数字/时间轴/撤销/整体拖拽)→ 分组 + 采样登记表的矩阵。
  // 走 onValuesChange 主动应用 + invalidate:frameloop="demand" 下光改
  // 属性不会自己出新帧(本组件只订阅了 points,变换变了不会重渲染)
  useEffect(() => {
    const apply = () => {
      const tr = readPathTransform(meta)
      pathRoot.position.set(tr.position.x, tr.position.y, tr.position.z)
      pathRoot.rotation.set(tr.rotation.x, tr.rotation.y, tr.rotation.z)
      pathRoot.scale.set(tr.scale.x, tr.scale.y, tr.scale.z)
      pathRoot.updateMatrixWorld(true)
      const reg = pathRegistry.get(metaKey)
      if (reg) composePathMatrix(tr, reg.matrix)
      invalidate()
    }
    apply()
    return meta.onValuesChange(apply)
  }, [meta, metaKey, pathRoot, invalidate])

  // 名单/曲线/锚点/矩阵登记给 ShotCamera 每帧采样
  useEffect(() => {
    const matrix = composePathMatrix(readPathTransform(meta), new Matrix4())
    pathRegistry.set(metaKey, {entries, curve, us, matrix})
    return () => {
      pathRegistry.delete(metaKey)
    }
  }, [metaKey, meta, entries, curve, us])

  // 路径本身可被选中(对齐 Blender:曲线是一等公民物体)——左键点线
  // 选中对应的名单对象(大纲高亮、属性面板出现),线色微微提亮
  const [isSelected, setIsSelected] = useState(false)
  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    const sync = () =>
      setIsSelected((studio.selection as unknown[]).includes(meta))
    sync()
    return studio.onSelectionChange(sync)
  }, [meta])

  // 对象模式的整体编辑(Blender):选中路径且不在编辑模式时,路径原点
  // (pathRoot)挂整体移动箭头,SelectionGizmo 的 G 抓取/R/S 模式也跟着
  // 生效——写回的都是路径对象的变换属性,控制点局部数据不动。编辑模式
  // 下注销,和控制点箭头不撞车
  const metaRef = useRef(meta)
  const pathRootRef = useRef(pathRoot)
  useSelectionGizmoTarget(metaRef, pathRootRef, !editing)

  useEffect(() => registerEditorOnly(line), [line])
  useEffect(() => registerEditorOnly(marker), [marker])
  useEffect(() => registerEditorOnly(handleLineL), [handleLineL])
  useEffect(() => registerEditorOnly(handleLineR), [handleLineR])
  useEffect(() => registerEditorOnly(arrows), [arrows])
  useEffect(() => registerEditorOnly(originMarker), [originMarker])

  // 调试/自动化验证挂钩:浏览器里直接摸线对象(射线/包围球排查用),
  // 与 __cameraPathEdit 同套;卸载自清
  useEffect(() => {
    const bag = ((window as any).__cameraPathLines ??= {})
    bag[metaKey] = {line, pathRoot}
    return () => {
      delete bag[metaKey]
    }
  }, [line, pathRoot, metaKey])

  // 名单变化 → 重写路径线顶点 + 重铺方向箭头(不用每帧:纯数据,变了才重建)
  useEffect(() => {
    const attr = line.geometry.getAttribute('position') as BufferAttribute
    const count = buildLinePositions(entries, attr.array as Float32Array)
    line.geometry.setDrawRange(0, count)
    attr.needsUpdate = true
    // 顶点是固定长缓冲就地重写,Line raycast 缓存的包围球不会自己更新;
    // 不重算的话平移/加点后射线粗测还在旧位置,点选/右键间歇性漏判
    line.geometry.computeBoundingSphere()
    line.visible = !hidden && count > 0
    // 方向箭头只在编辑模式出现(对齐 Blender:方向刻度是编辑态的叠加层),
    // 跟着线走:线可见且编辑中才可见
    const mats = directionArrowMatrices(curve, ARROW_MAX)
    mats.forEach((m, i) => arrows.setMatrixAt(i, m))
    arrows.count = mats.length
    arrows.instanceMatrix.needsUpdate = true
    arrows.visible = line.visible && editing
  }, [entries, curve, line, arrows, hidden, editing])

  // 模式/选中态 → 颜色和可见性(普通=蓝 → 选中=黄 → 编辑=亮黄)
  useEffect(() => {
    const lineColor = editing
      ? EDITING_LINE_COLOR
      : isSelected
        ? SELECTED_LINE_COLOR
        : new Color(color)
    ;(line.material as LineBasicMaterial).color.copy(lineColor)
    ;(marker.material as MeshBasicMaterial).color.set(color)
    // 箭头比线暗一档,免得一串圆锥盖过线本体
    ;(arrows.material as MeshBasicMaterial).color
      .copy(lineColor)
      .multiplyScalar(0.85)
    ;(originMarker.material as MeshBasicMaterial).color.copy(
      SELECTED_LINE_COLOR,
    )
    // 原点标记只在选中(对象模式)时出现;编辑模式选中态被清空,自然不出现
    originMarker.visible = isSelected && !hidden
  }, [editing, isSelected, color, hidden, line, marker, arrows, originMarker])

  const selectedIdx = entries.findIndex((e) => e.key === selectedKey)
  const selectedEntry = selectedIdx >= 0 ? entries[selectedIdx] : undefined

  // 选中的点被删/撤销掉了 → 通知 App 清选中
  useEffect(() => {
    if (selectedKey && !selectedEntry) {
      onSelectPoint(null)
    }
  }, [selectedKey, selectedEntry, onSelectPoint])

  // Esc:只取消进行中的拖拽(scrub 废弃即回滚),不退出编辑模式——同 Blender
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && scrubRef.current) {
        scrubRef.current.discard()
        scrubRef.current = undefined
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 进度标记 + 手柄连线:每帧跟(进度属性可能在上时间轴播放)
  useFrame(() => {
    // 只有一个点时没有曲线也没有线,进度标记钉在那个点上充当落点标识,
    // 否则单点路径在视口里完全不可见、不可选(只能从大纲进);
    // 编辑模式下控制点圆点已在,不叠这个标记
    const showMarker =
      !hidden && (curve ? true : entries.length > 0 && !editing)
    marker.visible = showMarker
    if (showMarker && curve) {
      sampleCurve(curve, us, progressOf(), marker.position)
    } else if (showMarker) {
      const p = entries[0]!.position
      marker.position.set(p.x, p.y, p.z)
    }
    // 手柄连线两端直接读节点当前位置:拖拽中也严丝合缝
    const pointNode = selectedKey
      ? pointNodesRef.current.get(selectedKey)
      : undefined
    const showHandles =
      editing && !hidden && !!pointNode && !!handleNodesRef.current.left
    handleLineL.visible = !!showHandles
    handleLineR.visible = !!showHandles
    if (showHandles && pointNode) {
      const {left, right} = handleNodesRef.current
      const writeLine = (lineObj: Line, target: Mesh | null) => {
        if (!target) return
        const attr = lineObj.geometry.getAttribute(
          'position',
        ) as BufferAttribute
        const arr = attr.array as Float32Array
        arr[0] = pointNode.position.x
        arr[1] = pointNode.position.y
        arr[2] = pointNode.position.z
        arr[3] = target.position.x
        arr[4] = target.position.y
        arr[5] = target.position.z
        attr.needsUpdate = true
      }
      writeLine(handleLineL, left)
      writeLine(handleLineR, right)
    }
  })

  // 控制点/手柄 = 屏幕恒定大小的编辑标记(Blender 同款:编辑 UI 叠加在
  // 画面上,不随视图缩放):每帧按到主相机的距离反推世界缩放,控制点圆片
  // 再广告牌化正对相机;路径自身的整体旋转/缩放也一并抵消,屏幕上永远
  // 同样大、同样正。深度测试已关(材质上),画在场景最上层
  const markerTmp = useRef({
    pos: new Vector3(),
    rootQuat: new Quaternion(),
    rootScale: new Vector3(),
    q: new Quaternion(),
  })
  useFrame((state) => {
    if (!editing || hidden) return
    const fov = (state.camera as {fov?: number}).fov
    if (typeof fov !== 'number') return
    const tan = Math.tan((fov * Math.PI) / 360)
    const hPx = state.size.height
    const {pos, rootQuat, rootScale, q} = markerTmp.current
    pathRoot.getWorldQuaternion(rootQuat)
    pathRoot.getWorldScale(rootScale)
    const applyScreenSize = (
      node: Object3D | null | undefined,
      px: number,
      billboard: boolean,
    ) => {
      if (!node) return
      const dist = node.getWorldPosition(pos).distanceTo(state.camera.position)
      const s = (2 * dist * tan * px) / hPx
      node.scale.set(s / rootScale.x, s / rootScale.y, s / rootScale.z)
      if (billboard) {
        node.quaternion.copy(
          q.copy(rootQuat).invert().multiply(state.camera.quaternion),
        )
      }
    }
    for (const node of pointNodesRef.current.values()) {
      applyScreenSize(node, POINT_SIZE_PX, true)
    }
    applyScreenSize(handleNodesRef.current.left, HANDLE_SIZE_PX, false)
    applyScreenSize(handleNodesRef.current.right, HANDLE_SIZE_PX, false)
  })

  const selectPointByKey = (key: string) => {
    // 清掉 theatre 对象的选中,对象 gizmo 和点的 gizmo 不同时出现
    getStudioSync()?.setSelection([])
    onSelectPoint(key)
  }
  const selectPoint = (key: string) => (event: ThreeEvent<MouseEvent>) => {
    if (isSelectSuppressed()) return
    event.stopPropagation()
    selectPointByKey(key)
  }

  // G:Blender 式模态抓取——选中的控制点跟随鼠标(过起点、正对相机的
  // 平面),X/Y/Z 锁轴,左键/回车确认,右键/Esc 整个废弃弹回原位
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || !editing || hidden || !selectedEntry) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )
        return
      // 箭头拖动中途不抢(scrub 一次只能开一个语义)
      if (scrubRef.current) return
      // 基线名单在起手时定格:整个抓取期间反复以它为底改写同一个点,
      // 一次确认 = 一步撤销(手柄镜像长度也取基线,拖多远超几度不累积)
      const baseline = entries
      const key = selectedEntry.key
      const p = selectedEntry.position
      // 抓取平面/捕获位置是世界坐标;起点和写回都要过一遍路径变换
      // (点存的是相对路径原点的局部坐标)
      startGrab({
        startPos: pathRoot.localToWorld(new Vector3(p.x, p.y, p.z)),
        dragging: false,
        capture: (scrub, worldPos) => {
          const local = pathRoot.worldToLocal(worldPos.clone())
          scrub.capture(({set}) =>
            set(
              meta.props.points,
              serializePathPoints(
                withMovedPoint(baseline, key, {
                  x: local.x,
                  y: local.y,
                  z: local.z,
                }),
              ),
            ),
          )
        },
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, hidden, selectedEntry, entries, meta, pathRoot, startGrab])

  // 拖动写回:按下开 scrub,拖动逐帧 capture,松手一次 commit = 一步撤销
  const gizmoTarget: Object3D | undefined = selectedKey
    ? pointNodesRef.current.get(selectedKey)
    : undefined

  // 点手柄的 controls 实例(ref 回调里填),给"节点被移除即摘手柄"用
  const pointGizmoRef = useRef<{detach?: () => void} | null>(null)
  // 手柄附着的点网格被移出场景(删点/撤销/整条路径卸载)时立刻摘手柄:
  // gizmoTarget 是渲染期读 ref 算出来的,删除点的那次渲染还会拿到已死的
  // 网格,React 下一次渲染才摘掉——空窗期 helper 每帧更新会撞 three 的
  // "must be a part of the scene graph" 报错。'removed' 事件同步于移除
  useEffect(() => {
    if (!gizmoTarget) return
    const detach = () => pointGizmoRef.current?.detach?.()
    gizmoTarget.addEventListener('removed', detach)
    return () => gizmoTarget.removeEventListener('removed', detach)
  }, [gizmoTarget])

  const onGizmoDown = () => {
    suppressSelectBriefly()
    scrubRef.current = getStudioSync()?.scrub()
  }
  const onGizmoChange = () => {
    suppressSelectBriefly()
    const scrub = scrubRef.current
    if (!scrub || !selectedKey) return
    const node = pointNodesRef.current.get(selectedKey)
    if (!node) return
    const p = node.position
    scrub.capture(({set}) =>
      set(
        meta.props.points,
        serializePathPoints(
          withMovedPoint(entries, selectedKey, {x: p.x, y: p.y, z: p.z}),
        ),
      ),
    )
  }
  const onGizmoUp = () => {
    suppressSelectBriefly()
    scrubRef.current?.commit()
    scrubRef.current = undefined
  }

  const handles = selectedEntry
    ? effectiveHandles(entries, selectedIdx)
    : undefined

  // 手柄圆点按住直接拖:和 G 同一套模态抓取(鼠标起手,松手确认,
  // Esc 取消);拖的是"手柄相对控制点的偏移",平面过手柄起点
  const startHandleDrag =
    (side: 'left' | 'right') => (event: ThreeEvent<PointerEvent>) => {
      if (isSelectSuppressed() || event.nativeEvent.button !== 0) return
      event.stopPropagation()
      if (!selectedEntry || !handles) return
      const baseline = entries
      const key = selectedEntry.key
      const p = selectedEntry.position
      const h = handles[side]
      // 抓取平面/捕获位置是世界坐标:起点把局部手柄端点乘上路径变换,
      // 写回时反算回局部再减控制点位置,得到局部偏移
      startGrab({
        startPos: pathRoot.localToWorld(
          new Vector3(p.x + h.x, p.y + h.y, p.z + h.z),
        ),
        dragging: true,
        capture: (scrub, worldPos) => {
          suppressSelectBriefly()
          const local = pathRoot.worldToLocal(worldPos.clone())
          scrub.capture(({set}) =>
            set(
              meta.props.points,
              serializePathPoints(
                withDraggedHandle(baseline, key, side, {
                  x: local.x - p.x,
                  y: local.y - p.y,
                  z: local.z - p.z,
                }),
              ),
            ),
          )
        },
      })
    }

  // 点线(或单点落点标记)= 选中这条路径;右键 = 路径菜单。
  // 线和标记共用一套,行为不分载体
  const handlePathClick = (event: ThreeEvent<MouseEvent>) => {
    // 镜头视角下路径不可见,不响应(线还在原地,只是没画)
    if (hidden || isSelectSuppressed()) return
    event.stopPropagation()
    if (editing) {
      // 编辑模式:点标记正好坐在曲线上,线 1 个世界单位的命中
      // 半径总会先吃到瞄准标记的点击——从同一次射线的全部命中
      // 里找到点标记并转发;其余点击就地吞掉,不穿透选中后面
      // 的东西(Blender 编辑模式:其他物体不响应视口点击)
      for (const hit of event.intersections) {
        for (const [key, node] of pointNodesRef.current) {
          if (hit.object === node) {
            selectPointByKey(key)
            return
          }
        }
      }
      return
    }
    // 点线 = 选中这条路径(名单对象):大纲高亮、Tab/右键随之作用到它
    getStudioSync()?.setSelection([meta])
  }
  const handlePathContextMenu = (event: ThreeEvent<MouseEvent>) => {
    // 镜头视角下路径不可见,右键不响应(线还在原地,只是没画)
    if (hidden) return
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    onContextMenu(metaKey, event.nativeEvent.clientX, event.nativeEvent.clientY)
  }

  return (
    <>
      {/* 路径的一切可视内容都挂在变换分组下,组内一律局部坐标;
          世界位置 = 分组的位置/旋转/缩放(路径对象的变换属性) */}
      <primitive object={pathRoot}>
        <primitive
          object={line}
          onClick={handlePathClick}
          onContextMenu={handlePathContextMenu}
        />
        {/* 进度标记;单点路径时兼任落点标识,所以也要能点/右键 */}
        <primitive
          object={marker}
          onClick={handlePathClick}
          onContextMenu={handlePathContextMenu}
        />
        <primitive object={arrows} />
        <primitive object={originMarker} />
        {editing &&
          !hidden &&
          entries.map((entry) => (
            <mesh
              key={entry.key}
              ref={(node: Mesh | null) => {
                if (node) {
                  pointNodesRef.current.set(entry.key, node)
                  registerEditorOnly(node)
                } else {
                  pointNodesRef.current.delete(entry.key)
                }
              }}
              position={[entry.position.x, entry.position.y, entry.position.z]}
              onClick={selectPoint(entry.key)}
              renderOrder={20}
            >
              {/* 单位圆片:每帧广告牌化 + 缩放到屏幕恒定大小(见上 useFrame) */}
              <circleGeometry args={[0.5, 24]} />
              <meshBasicMaterial
                color={entry.key === selectedKey ? '#ffffff' : color}
                toneMapped={false}
                side={DoubleSide}
                depthTest={false}
                transparent
              />
            </mesh>
          ))}
        {editing && !hidden && selectedEntry && handles && (
          <>
            <primitive object={handleLineL} />
            <primitive object={handleLineR} />
            {(['left', 'right'] as const).map((side) => {
              const h = handles[side]
              const p = selectedEntry.position
              return (
                <mesh
                  key={side}
                  ref={(node: Mesh | null) => {
                    handleNodesRef.current[side] = node
                    if (node) registerEditorOnly(node)
                  }}
                  position={[p.x + h.x, p.y + h.y, p.z + h.z]}
                  onPointerDown={startHandleDrag(side)}
                  renderOrder={20}
                >
                  {/* 单位球:每帧缩放到屏幕恒定大小(球从哪个方向看都是圆,
                      不用广告牌化) */}
                  <sphereGeometry args={[0.5, 16, 12]} />
                  <meshBasicMaterial
                    color={color}
                    toneMapped={false}
                    depthTest={false}
                    transparent
                  />
                </mesh>
              )
            })}
          </>
        )}
      </primitive>
      {editing && !hidden && !grabActive && gizmoTarget && (
        <TransformControls
          ref={(controls: any) => {
            pointGizmoRef.current = controls
            // 箭头本体登记为"仅编辑视角":画中画/镜头视角渲染时不入画。
            // three 0.185 的 TransformControls 不是 Object3D,可视部分在 getHelper()
            if (!controls) return
            const root: Object3D =
              typeof controls.getHelper === 'function'
                ? controls.getHelper()
                : controls
            return registerEditorOnly(root)
          }}
          object={gizmoTarget}
          mode="translate"
          onMouseDown={onGizmoDown}
          onObjectChange={onGizmoChange}
          onMouseUp={onGizmoUp}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// 路径编辑模式的工具浮条:加点/删点。点级操作的家——全局菜单不出现
// 这些(见菜单设计文档)。选中点的数值/锚点编辑在它下面的 PathPointEditor。

export function PathEditBar({
  hasSelection,
  onAddPoint,
  onDeleteSelected,
}: {
  hasSelection: boolean
  onAddPoint: () => void
  onDeleteSelected: () => void
}) {
  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid #555',
    background: 'transparent',
    color: disabled ? '#777' : '#eee',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12,
  })
  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: '#272730',
        border: '1px solid #444',
        borderRadius: 6,
        fontSize: 12,
        color: '#eee',
      }}
    >
      <button
        style={btn(false)}
        onClick={onAddPoint}
        title="在路径末尾续一个控制点"
      >
        加点
      </button>
      <button
        style={btn(!hasSelection)}
        disabled={!hasSelection}
        onClick={onDeleteSelected}
        title={hasSelection ? '删除选中的控制点' : '先点选一个控制点'}
      >
        删除选中点
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 数值浮条:编辑模式下选中控制点时的 X/Y/Z 数字输入(Blender N 面板的对应物),
// 外加进度锚点 u 的微调(不改路径形状、只改这个点在全程进度中的位置 =
// 局部变速)和"钉到播放头"(抵达时间变成时间轴上的标准关键帧)

/** 关键帧值和锚点判定"对得上"的容差(钉的时候写的就是锚点值,浮点直比即可) */
const PIN_MATCH_EPS = 5e-4

/** 一次输入提交 = 一步撤销;非法输入直接丢弃回显当前值 */
export function PathPointEditor({
  sheet,
  metaKey,
  pointKey,
  onPinAtPlayhead,
  progressKeyframes,
}: {
  sheet: ISheet
  metaKey: string
  pointKey: string
  /** 钉到播放头:给行进进度打一个值=锚点的关键帧(抵达时间上时间轴) */
  onPinAtPlayhead?: (u: number) => void
  /** 行进进度轨道的关键帧(时刻秒 + 进度值),列出"这个点钉在了哪些时间"用 */
  progressKeyframes?: readonly {position: number; value: number}[]
}) {
  const meta = useMemo(() => getPathMeta(sheet, metaKey), [sheet, metaKey])
  const entries = usePathPointEntries(meta)
  const curve = useMemo(() => buildCurve(entries), [entries])
  const us = useMemo(() => effectiveUs(entries, curve), [entries, curve])
  const idx = entries.findIndex((e) => e.key === pointKey)
  const entry = idx >= 0 ? entries[idx] : undefined

  if (!entry) return null
  // 端点锚点恒为 0/1(路径首尾的语义),只有中间点开放微调
  const isMiddle = idx > 0 && idx < entries.length - 1
  const uEffective = us[idx] ?? 0
  const pinnedTimes = (progressKeyframes ?? [])
    .filter((k) => Math.abs(k.value - uEffective) < PIN_MATCH_EPS)
    .map((k) => k.position)

  const commitU = (v: number) => {
    const studio = getStudioSync()
    if (!studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(
        meta.props.points,
        serializePathPoints(withMovedU(entries, pointKey, v, curve)),
      ),
    )
    scrub.commit()
  }
  const resetU = () => {
    const studio = getStudioSync()
    if (!studio) return
    const scrub = studio.scrub()
    scrub.capture(({set}) =>
      set(
        meta.props.points,
        serializePathPoints(withResetU(entries, pointKey)),
      ),
    )
    scrub.commit()
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: '#272730',
        border: '1px solid #444',
        borderRadius: 6,
        fontSize: 12,
        color: '#eee',
      }}
    >
      <span style={{color: '#999'}}>
        {pathLabel(metaKey)} · {pointKey}
      </span>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <AxisInput
          key={axis}
          axis={axis}
          value={entry.position[axis]}
          onCommit={(v) => {
            const studio = getStudioSync()
            if (!studio) return
            const scrub = studio.scrub()
            scrub.capture(({set}) =>
              set(
                meta.props.points,
                serializePathPoints(
                  withMovedPoint(entries, pointKey, {
                    ...entry.position,
                    [axis]: v,
                  }),
                ),
              ),
            )
            scrub.commit()
          }}
        />
      ))}
      {isMiddle && (
        <NumberInput
          label="进度"
          title="进度锚点(0~1):行进进度走到这个值时相机正好过这个点;改它不改路径形状,只改节奏(局部变速)"
          value={Math.round(uEffective * 1000) / 1000}
          step={0.01}
          width={56}
          onCommit={commitU}
        />
      )}
      {isMiddle && entry.u !== undefined && (
        <button
          onClick={resetU}
          title="清掉手动锚点,回到自动(弧长等比)"
          style={{
            background: 'transparent',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#bbb',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 6px',
          }}
        >
          自动
        </button>
      )}
      {onPinAtPlayhead && (
        <button
          onClick={() => onPinAtPlayhead(uEffective)}
          title="在当前播放头时间给行进进度打一个值=该点锚点的关键帧:这个点的抵达时间就此上时间轴,拖关键帧即改时间"
          style={{
            background: '#3a4a66',
            border: '1px solid #557',
            borderRadius: 4,
            color: '#cfe1ff',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 8px',
          }}
        >
          钉到播放头
        </button>
      )}
      {pinnedTimes.length > 0 && (
        <span style={{color: '#9fb8dd'}}>
          已钉:
          {pinnedTimes.map((t) => `t=${t.toFixed(2)}s`).join('、')}
        </span>
      )}
    </div>
  )
}

function AxisInput({
  axis,
  value,
  onCommit,
}: {
  axis: 'x' | 'y' | 'z'
  value: number
  onCommit: (v: number) => void
}) {
  return (
    <NumberInput
      label={axis}
      title="控制点的局部坐标(相对路径原点);整体挪路径用对象模式的位置属性/移动箭头"
      value={value}
      step={0.1}
      width={72}
      onCommit={onCommit}
    />
  )
}

/** 通用数值输入:未聚焦显示外部值(拖箭头/撤销实时反映),聚焦后是本地草稿,回车/失焦提交 */
function NumberInput({
  label,
  title,
  value,
  step,
  width,
  onCommit,
}: {
  label: string
  title?: string
  value: number
  step: number
  width: number
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(Math.round(value * 1000) / 1000)
  const commit = () => {
    if (draft !== null) {
      const v = Number(draft)
      if (Number.isFinite(v) && v !== value) onCommit(v)
    }
    setDraft(null)
  }
  return (
    <label
      title={title}
      style={{display: 'flex', alignItems: 'center', gap: 4}}
    >
      <span style={{color: '#999', textTransform: 'uppercase'}}>{label}</span>
      <input
        type="number"
        step={step}
        value={shown}
        onFocus={() => setDraft(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          width,
          background: '#1b1b22',
          border: '1px solid #444',
          borderRadius: 4,
          color: '#eee',
          fontSize: 12,
          padding: '3px 6px',
        }}
      />
    </label>
  )
}
