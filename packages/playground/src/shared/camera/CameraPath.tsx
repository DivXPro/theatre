import {useCurrentSheet} from '@toy-box/r3f'
import {getStudioSync, onChange, types as t} from '@toy-box/core'
import {privateAPI} from '@toy-box/core/privateAPIs'
import getStudioInternal from '@toy-box/studio/getStudio'
import getDeep from '@toy-box/utils/getDeep'
import type {IScrub, ISheet, ISheetObject} from '@toy-box/core'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useFrame} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {TransformControls} from '@react-three/drei'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type {CurvePath, Object3D} from 'three'
import {registerEditorOnly} from './editorOnly'
import {useModalGrab} from './modalGrab'
import {isSelectSuppressed, suppressSelectBriefly} from './PlacementManager'
import {
  buildCurve,
  buildLinePositions,
  effectiveHandles,
  extendPathPoint,
  nextPointKey,
  parsePathPoints,
  sampleCurve,
  serializePathPoints,
  withDraggedHandle,
  withMovedPoint,
} from './pathModel'
import type {PathPointEntry, Vec3Like} from './pathModel'

/**
 * 运镜路径:一条可编辑的空间曲线,机位/聚焦各用一条(同一个组件两次)。
 * 模型对齐 Blender 的曲线:
 *
 * - 控制点是纯数据,存在 `${metaKey}` 对象的 points 文本属性里(JSON 底账,
 *   勿手改)——不是 theatre 对象,不进大纲、不上时间轴,编辑全部在视口里
 * - 平时(对象模式)只显示路径线;右键路径线或按 Tab 进入编辑模式:
 *   线高亮、控制点小方块出现,可点选、挂三轴箭头沿轴精拖,或按 G 进入
 *   Blender 式模态抓取:点跟随鼠标(视图平面),X/Y/Z 锁轴,左键/回车
 *   确认,右键/Esc 取消
 * - 选中的控制点显示贝塞尔手柄(小圆点+连线):按住小圆点直接拖;
 *   默认自动(平滑穿过),拖动后转手动,两手柄方向共线(Blender 的"对齐");
 *   App 层另有数值浮条
 * - 拖动/增删都是一次 scrub 提交 = 一步撤销;镜头视角下整体隐藏
 */

export const POS_PATH_KEY = 'Shot / Pos Path'
export const AIM_PATH_KEY = 'Shot / Aim Path'

export function pathLabel(metaKey: string): string {
  return metaKey === AIM_PATH_KEY ? '聚焦路径' : '机位路径'
}

/** 路径线折线的顶点缓冲容量(段数多了会自动降低每段细分,不会溢出) */
const LINE_BUFFER_VERTS = 256
/** 虚线的段长/间隔(世界单位;路径一般十几单位长,这个密度一眼可读) */
const LINE_DASH_SIZE = 0.35
const LINE_GAP_SIZE = 0.22
/** 控制点小方块的边长 */
const POINT_SIZE = 0.18
/** 手柄小圆点的半径 */
const HANDLE_RADIUS = 0.09

// ---------------------------------------------------------------------------
// 名单元数据对象(theatre)

// t.string 每次调用生成新配置对象;sheet.object 对同一个 key 的重复调用
// 要求配置 deep-equal,函数按引用比——和 PlacementManager 的 fileConfigCache
// 同一个原因,配置按 metaKey 缓存成同一个引用
const metaConfigCache = new Map<string, {points: ReturnType<typeof t.string>}>()

export function getPathMeta(sheet: ISheet, metaKey: string) {
  let config = metaConfigCache.get(metaKey)
  if (!config) {
    // hidden: 纯数据底账不在属性面板出现(编辑全在视口/菜单,勿手改)
    config = {
      points: t.string('[]', {label: '控制点名单(JSON)', hidden: true}),
    }
    metaConfigCache.set(metaKey, config)
  }
  const meta = sheet.object(metaKey, config)
  // 调试/自动化验证挂钩:page 上下文拿不到 sheet.object(配置校验),
  // 名单对象从这里直接读(同 __cameraShot 的用法)
  ;((window as any).__cameraPathMeta ??= {})[metaKey] = meta
  return meta
}

/** 响应式读名单:scrub 提交/撤销/同步都会触发 onValuesChange */
function usePathPointEntries(meta: ISheetObject<{points: string}>) {
  const [entries, setEntries] = useState<PathPointEntry[]>(() =>
    parsePathPoints(meta.value.points),
  )
  useEffect(() => {
    setEntries(parsePathPoints(meta.value.points))
    return meta.onValuesChange(() =>
      setEntries(parsePathPoints(meta.value.points)),
    )
  }, [meta])
  return entries
}

/**
 * 响应式:路径是否有控制点。空路径时驱动自动回退手动(见 ShotCamera),
 * 相机仍可拖;ShotCamera 用它决定要不要锁掉移动箭头
 */
export function usePathHasPoints(sheet: ISheet, metaKey: string): boolean {
  const meta = useMemo(() => getPathMeta(sheet, metaKey), [sheet, metaKey])
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
// 采样登记表:metaKey → 最新名单 + 曲线(名单变化时重建,弧长缓存随曲线失效)

type RegisteredPath = {
  entries: PathPointEntry[]
  curve: CurvePath<Vector3> | null
}

const pathRegistry = new Map<string, RegisteredPath>()

/**
 * 按进度在路径上取点(弧长等比)。路径为空返回 false,调用方回退到
 * 手动驱动;单点路径任何进度都取那个点(聚焦锁主体)。
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
    return true
  }
  sampleCurve(reg.curve, u, out)
  return true
}

// ---------------------------------------------------------------------------
// 加点/删点(工具栏按钮调;一次 scrub 提交 = 一步撤销)

/**
 * 加一个控制点:路径为空时用 seed 播种(机位路径=绕目标的弧,
 * 聚焦路径=目标处单点),否则沿最后一段方向延伸。seed 为空且名单
 * 为空时不动作。
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
    next = seed.map((position, i) => ({key: `P${i + 1}`, position}))
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
 * 删除整条路径(名单清空)。路径对象本身留着(它是渲染时按需创建的,
 * 删了下一帧也会以空名单重建),所以"删除"就是清空——一次 scrub 提交
 * = 一步撤销,撤销即整条回来
 */
export function clearPath(sheet: ISheet, metaKey: string) {
  const studio = getStudioSync()
  if (!studio) return
  const meta = getPathMeta(sheet, metaKey)
  if (parsePathPoints(meta.value.points).length === 0) return
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(meta.props.points, serializePathPoints([])))
  scrub.commit()
}

/**
 * 整条路径平移 delta:所有控制点统一位移(贝塞尔手柄存的是相对偏移,
 * 天然跟着走)。一次 scrub 提交 = 一步撤销
 */
export function translatePath(sheet: ISheet, metaKey: string, delta: Vec3Like) {
  const studio = getStudioSync()
  if (!studio) return
  const meta = getPathMeta(sheet, metaKey)
  const list = parsePathPoints(meta.value.points)
  if (list.length === 0) return
  const next = list.map((e) => ({
    ...e,
    position: {
      x: e.position.x + delta.x,
      y: e.position.y + delta.y,
      z: e.position.z + delta.z,
    },
  }))
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(meta.props.points, serializePathPoints(next)))
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
    new LineDashedMaterial({
      color: 0xffffff,
      toneMapped: false,
      dashSize: LINE_DASH_SIZE,
      gapSize: LINE_GAP_SIZE,
    }),
  )
  // 顶点随名单重写,包围球不更新,关掉视锥剔除防止被误剔
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
    new LineBasicMaterial({color: 0xffffff, toneMapped: false}),
  )
  line.frustumCulled = false
  return line
}

/** 编辑态的线色:混入白色提亮,一眼看出"我在编辑这条路径" */
function editingColor(color: number): Color {
  return new Color(color).lerp(new Color(0xffffff), 0.45)
}

/** 选中态的线色:比编辑态弱一档的提亮(普通 → 选中 → 编辑中 三档分得开) */
function selectedColor(color: number): Color {
  return new Color(color).lerp(new Color(0xffffff), 0.22)
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
  /** 读当前进度(0~1),给进度标记用;来源是 Shot/Camera 的进度属性 */
  progressOf: () => number
}) {
  const sheet = useCurrentSheet()!
  const meta = useMemo(() => getPathMeta(sheet, metaKey), [sheet, metaKey])
  const entries = usePathPointEntries(meta)
  useKeepPointsPropStatic(meta)
  const curve = useMemo(() => buildCurve(entries), [entries])
  const line = useMemo(makePathLine, [])
  const marker = useMemo(makeProgressMarker, [])
  const handleLineL = useMemo(makeHandleLine, [])
  const handleLineR = useMemo(makeHandleLine, [])
  // 控制点/手柄的场景节点:控制点挂三轴箭头用(纯数据,不是 theatre 对象)
  const pointNodesRef = useRef(new Map<string, Mesh>())
  const handleNodesRef = useRef<{left: Mesh | null; right: Mesh | null}>({
    left: null,
    right: null,
  })
  const scrubRef = useRef<IScrub | undefined>(undefined)
  // Blender 式模态抓取:G 键抓控制点 / 按住手柄圆点直接拖,共用一套
  const {start: startGrab, active: grabActive} = useModalGrab()

  // 名单/曲线登记给 ShotCamera 每帧采样
  useEffect(() => {
    pathRegistry.set(metaKey, {entries, curve})
    return () => {
      pathRegistry.delete(metaKey)
    }
  }, [metaKey, entries, curve])

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

  useEffect(() => registerEditorOnly(line), [line])
  useEffect(() => registerEditorOnly(marker), [marker])
  useEffect(() => registerEditorOnly(handleLineL), [handleLineL])
  useEffect(() => registerEditorOnly(handleLineR), [handleLineR])

  // 名单变化 → 重写路径线顶点(不用每帧:纯数据,变了才重建)
  useEffect(() => {
    const attr = line.geometry.getAttribute('position') as BufferAttribute
    const count = buildLinePositions(entries, attr.array as Float32Array)
    line.geometry.setDrawRange(0, count)
    attr.needsUpdate = true
    // 虚线材质按线距着色,顶点变了必须重算(没用的尾部顶点在末尾,不影响前段)
    line.computeLineDistances()
    line.visible = !hidden && count > 0
  }, [entries, line, hidden])

  // 模式/选中态 → 颜色和可见性
  useEffect(() => {
    ;(line.material as LineDashedMaterial).color.copy(
      editing
        ? editingColor(color)
        : isSelected
          ? selectedColor(color)
          : new Color(color),
    )
    ;(marker.material as MeshBasicMaterial).color.set(color)
  }, [editing, isSelected, color, line, marker])

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
    const showMarker = !hidden && !!curve
    marker.visible = showMarker
    if (showMarker && curve) {
      sampleCurve(curve, progressOf(), marker.position)
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

  const selectPoint = (key: string) => (event: ThreeEvent<MouseEvent>) => {
    if (isSelectSuppressed()) return
    event.stopPropagation()
    // 清掉 theatre 对象的选中,对象 gizmo 和点的 gizmo 不同时出现
    getStudioSync()?.setSelection([])
    onSelectPoint(key)
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
      startGrab({
        startPos: new Vector3(p.x, p.y, p.z),
        dragging: false,
        capture: (scrub, worldPos) =>
          scrub.capture(({set}) =>
            set(
              meta.props.points,
              serializePathPoints(
                withMovedPoint(baseline, key, {
                  x: worldPos.x,
                  y: worldPos.y,
                  z: worldPos.z,
                }),
              ),
            ),
          ),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, hidden, selectedEntry, entries, meta, startGrab])

  // 拖动写回:按下开 scrub,拖动逐帧 capture,松手一次 commit = 一步撤销
  const gizmoTarget: Object3D | undefined = selectedKey
    ? pointNodesRef.current.get(selectedKey)
    : undefined

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
      startGrab({
        startPos: new Vector3(p.x + h.x, p.y + h.y, p.z + h.z),
        dragging: true,
        capture: (scrub, worldPos) => {
          suppressSelectBriefly()
          scrub.capture(({set}) =>
            set(
              meta.props.points,
              serializePathPoints(
                withDraggedHandle(baseline, key, side, {
                  x: worldPos.x - p.x,
                  y: worldPos.y - p.y,
                  z: worldPos.z - p.z,
                }),
              ),
            ),
          )
        },
      })
    }

  return (
    <>
      <primitive
        object={line}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          // 镜头视角下路径不可见,不响应(线还在原地,只是没画)
          if (hidden || isSelectSuppressed()) return
          event.stopPropagation()
          // 点线 = 选中这条路径(名单对象):大纲高亮、Tab/右键随之作用到它
          getStudioSync()?.setSelection([meta])
        }}
        onContextMenu={(event: ThreeEvent<MouseEvent>) => {
          // 镜头视角下路径不可见,右键不响应(线还在原地,只是没画)
          if (hidden) return
          event.stopPropagation()
          event.nativeEvent.preventDefault()
          onContextMenu(
            metaKey,
            event.nativeEvent.clientX,
            event.nativeEvent.clientY,
          )
        }}
      />
      <primitive object={marker} />
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
          >
            <boxGeometry args={[POINT_SIZE, POINT_SIZE, POINT_SIZE]} />
            <meshBasicMaterial
              color={entry.key === selectedKey ? '#ffffff' : color}
              wireframe
              toneMapped={false}
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
              >
                <sphereGeometry args={[HANDLE_RADIUS, 12, 8]} />
                <meshBasicMaterial color={color} toneMapped={false} />
              </mesh>
            )
          })}
        </>
      )}
      {editing && !hidden && !grabActive && gizmoTarget && (
        <TransformControls
          ref={(controls: any) => {
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
// 数值浮条:编辑模式下选中控制点时的 X/Y/Z 数字输入(Blender N 面板的对应物)

/** 一次输入提交 = 一步撤销;非法输入直接丢弃回显当前值 */
export function PathPointEditor({
  sheet,
  metaKey,
  pointKey,
}: {
  sheet: ISheet
  metaKey: string
  pointKey: string
}) {
  const meta = useMemo(() => getPathMeta(sheet, metaKey), [sheet, metaKey])
  const entries = usePathPointEntries(meta)
  const entry = entries.find((e) => e.key === pointKey)

  if (!entry) return null
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
  // 未聚焦时显示外部值(拖箭头/撤销会实时反映);聚焦后显示本地草稿
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
    <label style={{display: 'flex', alignItems: 'center', gap: 4}}>
      <span style={{color: '#999', textTransform: 'uppercase'}}>{axis}</span>
      <input
        type="number"
        step={0.1}
        value={shown}
        onFocus={() => setDraft(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          width: 72,
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
