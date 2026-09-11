import {editable as e} from '@dreamerbird/r3f'
import {getStudioSync, onChange, types as t, val} from '@dreamerbird/core'
import type {IProject, IScrub, ISheet, ISheetObject} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {useVal} from '@dreamerbird/react'
import {TransformControls, useFBX} from '@react-three/drei'
import {useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {AnimationMixer, Box3, Raycaster, Vector3} from 'three'
import type {Group, Mesh, Object3D, AnimationClip, AnimationAction} from 'three'
import {SkeletonUtils} from 'three-stdlib'
import {createGLTFLoader} from './assetLibrary/gltfLoader'
import {getLibrary} from './assetLibrary/library'
import {entryOptions} from './assetLibrary/options'
import {computeDropPoint} from './dropPoint'
import {registerEditorOnly} from './editorOnly'
import {useModalGrab} from './modalGrab'
import {disposeObjectTree} from './assetLibrary/dispose'
import {applyPose, captureBindPose} from './assetLibrary/pose'
import type {ModelEntry, PoseEntry} from './assetLibrary/types'

/**
 * FBX 模型放置:页面顶部按钮选文件进入放置模式,半透明 ghost 跟随光标
 * (落点取物体表面优先,y=0 地面兜底),左键确认、Esc/右键取消。
 *
 * 确认后模型成为 theatre 可编辑对象(位置/旋转/缩放 + source 文件属性),
 * 放置清单写进 "Placements" sheet 对象(string prop 存 JSON),一次 scrub
 * 提交 = 一步撤销(撤销即模型消失)。模型文件本体走 studio 的资产库存进
 * IndexedDB,刷新后按清单 + 资产 id 恢复。
 *
 * 带骨架动画的 FBX:每个实例克隆独立骨架 + AnimationMixer,自动播放第一个
 * 动画片段,但只在 theatre 序列播放(空格/播放键)时驱动——编辑时模型静止,
 * 方便摆姿势。ghost 预览始终静止。
 *
 * 点选与移动:画布左键点已放置的模型即加入 studio 选中(放置模式下点击
 * 仍是确认落点),选中后对象上挂三轴移动箭头(SelectionGizmo),拖箭头
 * 实时改位置,一次拖动 = 一步撤销。想让别的可编辑对象也有箭头,
 * 用 useSelectionGizmoTarget 登记即可(App 里的 Thingy 就是)。
 *
 * 已知边界:
 *  - 撤销放置后,theatre 里会留下一个空的 "Placed/..." 对象(对象一经创建
 *    不能从公开 API 删除),重新加载后消失于大纲是 theatre 自身行为,不影响场景
 *  - 资产 blob 只存本地 IndexedDB;另一个客户端收到同步的清单但本地没有文件时,
 *    该模型不渲染(错误边界兜住,不影响其它内容)
 */

type PlacementEntry = {
  key: string
  /** 本地 FBX 路径的 theatre 资产 id;库来源的条目没有此字段 */
  assetId?: string
  /** 库来源条目的 id;存在时优先从资产库加载 GLB */
  libraryEntryId?: string
  position: {x: number; y: number; z: number}
}

/** 已确认但尚未提交进清单的放置:先渲染,挂载后在 effect 里一次性提交 */
type PendingPlacementEntry = PlacementEntry & {pending: true}

type PlacementSource =
  | {type: 'local'; file: File; assetId: string}
  | {type: 'library'; entryId: string}

export type PlacingState = {
  url: string
  label: string
  source: PlacementSource
}

const REGISTRY_KEY = 'Placements'

// IProject 的公开类型上没有 assetStorage:它在内部 Project 实例上,
// 由 studio attach 完成后挂上真实存储(之前是会抛错的占位实现)。
// 这里通过 privateAPI 取内部实例,只用到两个方法。
type AssetStorage = {
  getAssetUrl: (assetId: string) => string
  createAsset: (file: File) => Promise<string | null>
}

function assetStorageOf(project: IProject): AssetStorage | undefined {
  const internal = privateAPI(project as any) as unknown as
    | {assetStorage?: AssetStorage}
    | undefined
  return internal?.assetStorage
}

/**
 * 每个资产 id 的 file 属性配置,模块级缓存。
 * t.file/t.number 每次调用都会生成新的闭包(interpolate 等),而 sheet.object
 * 对同一个 key 的重复调用要求配置 fast-deep-equal(函数按引用比)——
 * 只有缓存成同一个对象引用,命令式创建和 <e.group additionalProps>
 * 两条路径的配置才能相等。
 */
const fileConfigCache = new Map<string, ReturnType<typeof t.file>>()

/**
 * 动作/姿势下拉配置,按 (属性, 模型库条目 id) 缓存。
 * 和上面 fileConfigCache 同一个原因:sheet.object 对同一 key 的重复调用
 * 要求配置 fast-deep-equal(函数按引用比),所以闭包不能每次新建。
 * 选项函数本身不闭包骨架族,而是闭包模型条目 id,调用时才从库快照解析
 * rig——配置从首次渲染起引用稳定,快照就绪后筛选自动生效。
 */
const literalConfigCache = new Map<string, ReturnType<typeof t.stringLiteral>>()

function literalConfigFor(
  kind: 'animation' | 'pose',
  modelEntryId: string | undefined,
) {
  const cacheKey = `${kind}:${modelEntryId ?? ''}`
  let config = literalConfigCache.get(cacheKey)
  if (!config) {
    config = t.stringLiteral(
      '',
      () => entryOptions(getLibrary().getEntriesSnapshot(), kind, modelEntryId),
      {label: kind === 'animation' ? '动作' : '姿势', as: 'menu'},
    )
    literalConfigCache.set(cacheKey, config)
  }
  return config
}

/** 已放置模型的 theatre 对象 → {PlacementEntry, 场景实例} 映射,
 * App 通过 selection 反查 rig,Task 6 用 instance 抽帧。
 */
const placementObjects = new Map<
  ISheetObject<any>,
  {entry: PlacementEntry; instance: Group}
>()

export function getPlacementEntryForObject(
  obj: ISheetObject<any>,
): PlacementEntry | undefined {
  return placementObjects.get(obj)?.entry
}

/** 按 theatre 对象取已放置实例的 entry 与场景 Group,供 App 抽帧/查 rig 用 */
export function getPlacementInstanceForObject(
  obj: ISheetObject<any>,
): {entry: PlacementEntry; instance: Group} | undefined {
  return placementObjects.get(obj)
}

/** 统计场景里引用某库条目的已放置实例数(模型本体/动作/姿势三种引用) */
export function countLibraryEntryUsage(entryId: string): number {
  let n = 0
  for (const [obj, {entry}] of placementObjects.entries()) {
    if (entry.libraryEntryId === entryId) n++
    if (val(obj.props.animation) === entryId) n++
    if (val(obj.props.pose) === entryId) n++
  }
  return n
}

function fileConfigFor(assetId: string) {
  let config = fileConfigCache.get(assetId)
  if (!config) {
    config = t.file(assetId)
    fileConfigCache.set(assetId, config)
  }
  return config
}

function getRegistry(sheet: ISheet) {
  return sheet.object(REGISTRY_KEY, {list: t.string('[]')})
}

/**
 * 放置时射线检测的目标清单(模块级登记表)。
 * 只有登记过的分组才参与落点检测——ghost 本身、星星、gizmo、相机子树
 * 都不在表里,检测时直接跳过,不用测完再过滤。模型面数越高省得越多。
 * 想让人能把模型摞在已有模型上,就把对应分组登记进来。
 */
const placementSurfaces = new Set<Object3D>()

/** 把 ref 指向的分组登记为落点表面,卸载时自动移除 */
export function usePlacementSurface(ref: React.RefObject<Object3D | null>) {
  useEffect(() => {
    const obj = ref.current
    if (!obj) return
    placementSurfaces.add(obj)
    return () => {
      placementSurfaces.delete(obj)
    }
  }, [ref])
}

/** 落点表面登记表的只读视图(路径预设落点标记也用这套射线目标) */
export function getPlacementSurfaces(): ReadonlySet<Object3D> {
  return placementSurfaces
}

/**
 * 选中 gizmo 的目标登记表:"theatre 对象 → 场景节点"。
 * 想让某个可编辑对象被选中后挂移动箭头,就用 useSelectionGizmoTarget
 * 把它的 theatre 对象和场景节点登记进来(已放置的模型、Thingy 都是)。
 */
const selectionGizmoTargets = new Map<ISheetObject<any>, Object3D>()

/**
 * 登记表变更通知:SelectionGizmo 只在选中变化时重算附着目标,
 * 但"登记被注销"也要立刻反映(比如路径驱动启用时,正选中的相机
 * 箭头要马上收起来)——登记/注销都通过这里广播
 */
const gizmoRegistryListeners = new Set<() => void>()

function notifyGizmoRegistryChange() {
  gizmoRegistryListeners.forEach((l) => l())
}

/**
 * 把 ref 指向的节点登记为选中 gizmo 的附着目标,卸载时自动移除。
 * enabled=false 时不登记:驱动被路径接管的对象(沿路径的相机/瞄准点)
 * 拖了也不生效,箭头干脆不出现(对齐 Blender 约束激活时物体拖不动)
 */
export function useSelectionGizmoTarget(
  objRef: React.RefObject<ISheetObject<any> | undefined>,
  nodeRef: React.RefObject<Object3D | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return
    const obj = objRef.current
    const node = nodeRef.current
    if (!obj || !node) return
    selectionGizmoTargets.set(obj, node)
    notifyGizmoRegistryChange()
    return () => {
      selectionGizmoTargets.delete(obj)
      notifyGizmoRegistryChange()
    }
    // 两个 ref 都是挂载后不再变的;enabled 翻转时注销/重新登记
  }, [enabled])
}

/**
 * 点 gizmo 箭头时射线会穿过箭头打到后面的模型,松手那一下会被误当成
 * "点击选中别的模型"。拖 gizmo 期间和松手后一小段时间内,点选一律忽略。
 */
let suppressSelectUntil = 0

/** 当前这次点击是否该被 gizmo 吞掉(场景里所有点选入口共用一个判断) */
export function isSelectSuppressed() {
  return performance.now() < suppressSelectUntil
}

/** 拖 gizmo 期间/松手后短暂屏蔽场景点选(路径控制点的手柄也在用) */
export function suppressSelectBriefly() {
  suppressSelectUntil = performance.now() + 200
}

function readRegistry(
  registry: ISheetObject<{list: string}>,
): PlacementEntry[] {
  try {
    const list = JSON.parse(registry.value.list)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 所有已放置模型的落点(给 findFreeSpot 算默认位用) */
export function readPlacementPositions(
  sheet: ISheet,
): Array<{x: number; y: number; z: number}> {
  return readRegistry(getRegistry(sheet)).map((e) => e.position)
}

/**
 * 等资产存储就绪:attach 完成前 project.assetStorage 还是占位实现,
 * getAssetUrl 只会返回 "undefined/<id>" 假地址(theatre 官方也要求
 * project.ready 之后再取资产地址)。就绪前渲染已放置模型必然 404。
 */
function useProjectReady(project: IProject): boolean {
  const [ready, setReady] = useState(() => project.isReady)
  useEffect(() => {
    if (ready) return
    let cancelled = false
    void project.ready.then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [project, ready])
  return ready
}

/** 响应式读放置清单:scrub 提交/撤销/同步都会触发 onValuesChange */
function usePlacementsList(sheet: ISheet): PlacementEntry[] {
  const registry = useMemo(() => getRegistry(sheet), [sheet])
  const [list, setList] = useState<PlacementEntry[]>(() =>
    readRegistry(registry),
  )
  useEffect(() => {
    setList(readRegistry(registry))
    return registry.onValuesChange(() => setList(readRegistry(registry)))
  }, [registry])
  return list
}

/** 归一化:任意 FBX 单位差异很大,统一缩放到最大边 5 个世界单位,底部对齐落点 */
function useNormalizedModel(fbx: Group) {
  return useMemo(() => {
    const box = new Box3().setFromObject(fbx)
    const size = box.getSize(new Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    return {
      scale: maxDim > 0 ? 5 / maxDim : 1,
      // lift 是模型局部单位,放进 scale 过的组里后底部正好落在 y=0
      lift: -box.min.y,
    }
  }, [fbx])
}

/** ghost:克隆一份(SkinnedMesh 安全),材质全部换成半透明 */
function makeGhost(fbx: Group): Group {
  const ghost = SkeletonUtils.clone(fbx) as Group
  ghost.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const ghosted = materials.map((m) => {
      const c = m.clone()
      c.transparent = true
      c.opacity = 0.4
      c.depthWrite = false
      return c
    })
    mesh.material = Array.isArray(mesh.material) ? ghosted : ghosted[0]
  })
  return ghost
}

/**
 * 放置状态的控制器:选文件 → 存资产 + 进放置模式;确认 → 先放入 pending
 * (模型立刻渲染),持久化由 PlacedModel 挂载后一次性提交(清单 + source
 * 静态覆盖同一个 scrub,一步撤销);取消/确认后释放 blob URL。
 */
export function usePlacementController(project: IProject) {
  const [placing, setPlacing] = useState<PlacingState | null>(null)
  const [pendingEntry, setPendingEntry] =
    useState<PendingPlacementEntry | null>(null)

  const startPlacing = useCallback(
    async (file: File) => {
      // 等 attach 完成:占位存储的 createAsset 会直接抛错
      await project.ready
      const storage = assetStorageOf(project)
      if (!storage) {
        console.warn('[placement] 没有 studio 资产存储,无法放置')
        return
      }
      // 重名且内容不同时 createAsset 会弹窗让用户改名;返回 null 即用户取消或失败
      let assetId: string | null = null
      try {
        assetId = await storage.createAsset(file)
      } catch (err) {
        console.warn('[placement] 创建资产失败', err)
        return
      }
      if (!assetId) return
      setPlacing({
        url: URL.createObjectURL(file),
        label: file.name,
        source: {type: 'local', file, assetId},
      })
    },
    [project],
  )

  /** 从资产库选模型进入放置模式:不创建 theatre 项目资产 */
  const libraryGenRef = useRef(0)
  const startPlacingFromLibrary = useCallback(async (entry: ModelEntry) => {
    const gen = ++libraryGenRef.current
    const url = await getLibrary().backend.getBlobUrl(entry.blobId)
    // 用户快速切换选择时,旧加载结果直接丢弃
    if (gen !== libraryGenRef.current) return
    setPlacing({
      url,
      label: entry.name,
      source: {type: 'library', entryId: entry.id},
    })
  }, [])

  const cancelPlacing = useCallback(() => {
    setPlacing((p) => {
      // 本地文件是自己创建的 blob URL,库 URL 由 backend 管理生命周期
      if (p && p.source.type === 'local') URL.revokeObjectURL(p.url)
      return null
    })
  }, [])

  const confirmPlacing = useCallback(
    (point: {x: number; y: number; z: number}) => {
      if (!placing) return
      // theatreKey 只能含安全字符,文件名其余字符换成下划线
      const base =
        placing.label.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_') || 'model'
      if (placing.source.type === 'local') {
        setPendingEntry({
          key: `Placed / ${base}-${Date.now().toString(36)}`,
          assetId: placing.source.assetId,
          position: point,
          pending: true,
        })
      } else {
        setPendingEntry({
          key: `Placed / ${base}-${Date.now().toString(36)}`,
          libraryEntryId: placing.source.entryId,
          position: point,
          pending: true,
        })
      }
      if (placing.source.type === 'local') URL.revokeObjectURL(placing.url)
      setPlacing(null)
    },
    [placing],
  )

  /** 点击库卡片直接落点:跳过幽灵预览,走与 confirmPlacing 相同的落地管线 */
  const placeLibraryEntryAt = useCallback(
    (entry: ModelEntry, point: {x: number; y: number; z: number}) => {
      const base =
        entry.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_') || 'model'
      setPendingEntry({
        key: `Placed / ${base}-${Date.now().toString(36)}`,
        libraryEntryId: entry.id,
        position: point,
        pending: true,
      })
    },
    [],
  )

  const clearPending = useCallback(() => setPendingEntry(null), [])

  return {
    placing,
    pendingEntry,
    startPlacing,
    startPlacingFromLibrary,
    cancelPlacing,
    confirmPlacing,
    placeLibraryEntryAt,
    clearPending,
  }
}

/**
 * 放置模式下的 Canvas 内容:半透明 ghost 跟随光标。
 * 事件走 canvas 的 DOM 监听 + 手动射线检测,不用不可见网格接事件——
 * 视线与地面平行时网格永远打不中,事件根本不触发,看起来就是"没反应"。
 * 落点规则:物体表面优先;y=0 地面(数学平面,无限大)兜底;视线与地面
 * 平行或朝天时再退到"前方 30 个单位、压到地面",保证任何视角都有落点预览。
 */
export function PlacementRig(props: {
  placing: PlacingState
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  /** 拖拽放置:按下发生在面板卡片上,画布内松手才是确认 */
  confirmOnPointerUp?: boolean
}) {
  return props.placing.source.type === 'local' ? (
    <PlacementRigFBX {...props} />
  ) : (
    <PlacementRigGLTF {...props} />
  )
}

/** 本地 FBX 预览:用 drei 的 useFBX,加载完交给公共的 Rig 逻辑 */
function PlacementRigFBX({
  placing,
  onConfirm,
  onCancel,
  confirmOnPointerUp,
}: {
  placing: PlacingState
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  confirmOnPointerUp?: boolean
}) {
  const fbx = useFBX(placing.url)
  return (
    <PlacementRigCore
      model={fbx}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmOnPointerUp={confirmOnPointerUp}
    />
  )
}

/** 资产库 GLB 预览:用 GLTFLoader 异步加载,失败时交给错误边界 */
function PlacementRigGLTF({
  placing,
  onConfirm,
  onCancel,
  confirmOnPointerUp,
}: {
  placing: PlacingState
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  confirmOnPointerUp?: boolean
}) {
  const [model, setModel] = useState<Group | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    const loader = createGLTFLoader()
    loader
      .loadAsync(placing.url)
      .then((gltf) => {
        if (!cancelled) setModel(gltf.scene as Group)
      })
      .catch((err) => {
        console.warn('[placement] 库模型预览加载失败', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [placing.url])
  // 卸载或 URL 变化时释放模型 GPU 资源
  useEffect(() => {
    return () => {
      if (model) disposeObjectTree(model)
    }
  }, [model])
  if (failed) throw new Error('[placement] 库模型预览加载失败')
  if (!model) return null
  return (
    <PlacementRigCore
      model={model}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmOnPointerUp={confirmOnPointerUp}
    />
  )
}

/** 放置模式下的 Canvas 内容:半透明 ghost 跟随光标。
 * 事件走 canvas 的 DOM 监听 + 手动射线检测,不用不可见网格接事件——
 * 视线与地面平行时网格永远打不中,事件根本不触发,看起来就是"没反应"。
 * 落点规则:物体表面优先;y=0 地面(数学平面,无限大)兜底;视线与地面
 * 平行或朝天时再退到"前方 30 个单位、压到地面",保证任何视角都有落点预览。 */
function PlacementRigCore({
  model,
  onConfirm,
  onCancel,
  confirmOnPointerUp,
}: {
  model: Group
  onConfirm: (point: {x: number; y: number; z: number}) => void
  onCancel: () => void
  confirmOnPointerUp?: boolean
}) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const ghost = useMemo(() => makeGhost(model), [model])
  const {scale, lift} = useNormalizedModel(model)
  const ghostRef = useRef<Group>(null!)
  const raycaster = useMemo(() => new Raycaster(), [])

  const computePoint = useCallback(
    (clientX: number, clientY: number): Vector3 =>
      computeDropPoint(
        raycaster,
        camera,
        placementSurfaces,
        gl.domElement.getBoundingClientRect(),
        clientX,
        clientY,
      ),
    [gl, camera, raycaster],
  )

  // 鼠标事件只记坐标并申请一帧,真正的落点计算在帧回调里做一次——
  // pointermove 一秒能来上百次(每次都全量射线检测会很卡),渲染帧一秒最多 60 次
  const pendingMoveRef = useRef<{x: number; y: number} | null>(null)
  useFrame(() => {
    const pending = pendingMoveRef.current
    if (!pending) return
    pendingMoveRef.current = null
    const p = computePoint(pending.x, pending.y)
    if (ghostRef.current) {
      ghostRef.current.visible = true
      ghostRef.current.position.copy(p)
    }
  })

  useEffect(() => {
    const el = gl.domElement
    let downPos: {x: number; y: number} | null = null

    const onMove = (ev: PointerEvent) => {
      pendingMoveRef.current = {x: ev.clientX, y: ev.clientY}
      invalidate()
    }
    const onDown = (ev: PointerEvent) => {
      downPos = {x: ev.clientX, y: ev.clientY}
    }
    const onClick = (ev: MouseEvent) => {
      if (ev.button !== 0) return
      // 拖拽模式下画布点击不确认,确认只走松手
      if (confirmOnPointerUp) return
      // 拖动后的松手不算点击
      if (
        downPos &&
        Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 2
      )
        return
      const p = computePoint(ev.clientX, ev.clientY)
      // 太远的落点直接忽略,留在放置模式里(防止误放到天边)
      if (p.distanceTo(camera.position) > 300) return
      onConfirm({x: p.x, y: p.y, z: p.z})
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel()
    }
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault()
      onCancel()
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [
    gl,
    computePoint,
    camera,
    invalidate,
    onConfirm,
    onCancel,
    confirmOnPointerUp,
  ])

  // 拖拽模式:按下发生在面板卡片上,松手才是确认。松手在画布外(面板区域)
  // = 取消;太远(>300)也取消,防止误放到天边
  useEffect(() => {
    if (!confirmOnPointerUp) return
    const el = gl.domElement
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      // 画布铺满全窗口、垫在面板之下:松手在面板/工具栏等 DOM 上时 target 不是画布,
      // 必须取消(spec:松手在面板区域 = 静默取消)。提示条 pointerEvents:none 不挡
      if (ev.target !== el) {
        onCancel()
        return
      }
      const p = computePoint(ev.clientX, ev.clientY)
      if (p.distanceTo(camera.position) > 300) {
        onCancel()
        return
      }
      onConfirm({x: p.x, y: p.y, z: p.z})
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [confirmOnPointerUp, gl, camera, computePoint, onConfirm, onCancel])

  return (
    // 首次 pointermove 之前不显示,避免在原地闪一下
    <group ref={ghostRef} scale={scale} visible={false}>
      <primitive object={ghost} position={[0, lift, 0]} />
    </group>
  )
}

/** FBX 解析失败(文件损坏/格式太老)时取消放置,而不是崩掉画布、卡住按钮 */
export class PlacementRigErrorBoundary extends React.Component<
  {onCancel: () => void; children: React.ReactNode},
  {failed: boolean}
> {
  state = {failed: false}
  static getDerivedStateFromError() {
    return {failed: true}
  }
  componentDidCatch(err: unknown) {
    console.warn('[placement] 模型文件解析失败,已取消放置', err)
    this.props.onCancel()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** 已放置的模型们:按清单渲染(外加刚确认、待提交的那条),每个是独立的 theatre 可编辑对象 */
export function PlacedModels({
  sheet,
  project,
  pendingEntry,
  onPersisted,
  selectLocked,
  onObjectMenu,
}: {
  sheet: ISheet
  project: IProject
  pendingEntry: PendingPlacementEntry | null
  onPersisted: () => void
  selectLocked?: boolean
  onObjectMenu?: (key: string, x: number, y: number) => void
}) {
  const list = usePlacementsList(sheet)
  const ready = useProjectReady(project)
  // pending 提交进清单(list)到 clearPending 之间有一瞬两边都渲染,
  // React 报 duplicate key;已在清单里的 pending 副本直接跳过
  const entries: Array<PlacementEntry | PendingPlacementEntry> =
    pendingEntry && !list.some((e) => e.key === pendingEntry.key)
      ? [...list, pendingEntry]
      : list
  if (!ready) return null
  return (
    <>
      {entries.map((entry) => (
        <Suspense key={entry.key} fallback={null}>
          <PlacedModelErrorBoundary
            entry={entry}
            project={project}
            sheet={sheet}
            onPersisted={onPersisted}
            selectLocked={selectLocked}
            onObjectMenu={onObjectMenu}
          />
        </Suspense>
      ))}
    </>
  )
}

function PlacedModel({
  entry,
  project,
  sheet,
  onPersisted,
  selectLocked,
  onObjectMenu,
}: {
  entry: PlacementEntry | PendingPlacementEntry
  project: IProject
  sheet: ISheet
  onPersisted: () => void
  selectLocked?: boolean
  onObjectMenu?: (key: string, x: number, y: number) => void
}) {
  if (entry.libraryEntryId) {
    return (
      <LibraryPlacedModel
        entry={entry}
        project={project}
        sheet={sheet}
        onPersisted={onPersisted}
        selectLocked={selectLocked}
        onObjectMenu={onObjectMenu}
      />
    )
  }
  return (
    <FBXPlacedModel
      entry={entry}
      project={project}
      sheet={sheet}
      onPersisted={onPersisted}
      selectLocked={selectLocked}
      onObjectMenu={onObjectMenu}
    />
  )
}

/** 旧本地 FBX 路径:通过 theatre assetStorage 取 URL,再用 useFBX 加载 */
function FBXPlacedModel({
  entry,
  project,
  sheet,
  onPersisted,
  selectLocked,
  onObjectMenu,
}: {
  entry: PlacementEntry | PendingPlacementEntry
  project: IProject
  sheet: ISheet
  onPersisted: () => void
  selectLocked?: boolean
  onObjectMenu?: (key: string, x: number, y: number) => void
}) {
  const url = useMemo(() => {
    const storage = assetStorageOf(project)
    if (!storage || !entry.assetId) throw new Error('asset storage unavailable')
    return storage.getAssetUrl(entry.assetId)
  }, [project, entry.assetId])
  const fbx = useFBX(url)
  return (
    <PlacedModelCore
      entry={entry}
      sheet={sheet}
      group={fbx}
      animations={fbx.animations}
      sourceType="local"
      onPersisted={onPersisted}
      selectLocked={selectLocked}
      onObjectMenu={onObjectMenu}
    />
  )
}

/** 资产库 GLB 路径:解析条目、取 blob URL、用 GLTFLoader 异步加载 */
function LibraryPlacedModel({
  entry,
  project,
  sheet,
  onPersisted,
  selectLocked,
  onObjectMenu,
}: {
  entry: PlacementEntry | PendingPlacementEntry
  project: IProject
  sheet: ISheet
  onPersisted: () => void
  selectLocked?: boolean
  onObjectMenu?: (key: string, x: number, y: number) => void
}) {
  const [loaded, setLoaded] = useState<{
    group: Group
    animations: AnimationClip[]
  } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const libEntry = await getLibrary().backend.getEntry(
          entry.libraryEntryId!,
        )
        if (!libEntry || libEntry.kind !== 'model') {
          throw new Error('library model entry not found')
        }
        const url = await getLibrary().backend.getBlobUrl(libEntry.blobId)
        const gltf = await createGLTFLoader().loadAsync(url)
        if (!cancelled) {
          setLoaded({
            group: gltf.scene as Group,
            animations: gltf.animations,
          })
        }
      } catch (err) {
        console.warn('[placement] 库模型加载失败', err)
        if (!cancelled) setFailed(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [entry.libraryEntryId])
  // 卸载或条目变化时释放已加载模型
  useEffect(() => {
    return () => {
      if (loaded?.group) disposeObjectTree(loaded.group)
    }
  }, [loaded?.group])
  if (failed) throw new Error('[placement] 库模型加载失败')
  if (!loaded) return null
  return (
    <PlacedModelCore
      entry={entry}
      sheet={sheet}
      group={loaded.group}
      animations={loaded.animations}
      sourceType="library"
      onPersisted={onPersisted}
      selectLocked={selectLocked}
      onObjectMenu={onObjectMenu}
    />
  )
}

/** 已加载 Group 之后的公共逻辑:克隆、归一化、动画 mixer、点选菜单、持久化 */
function PlacedModelCore({
  entry,
  sheet,
  group,
  animations,
  sourceType,
  onPersisted,
  selectLocked,
  onObjectMenu,
}: {
  entry: PlacementEntry | PendingPlacementEntry
  sheet: ISheet
  group: Group
  animations: AnimationClip[]
  sourceType: 'local' | 'library'
  onPersisted: () => void
  selectLocked?: boolean
  onObjectMenu?: (key: string, x: number, y: number) => void
}) {
  const additionalProps = useMemo(() => {
    const modelEntryId =
      sourceType === 'library' ? entry.libraryEntryId : undefined
    const props: Record<string, any> = {
      animation: literalConfigFor('animation', modelEntryId),
      pose: literalConfigFor('pose', modelEntryId),
    }
    if (sourceType === 'local' && entry.assetId) {
      props.source = fileConfigFor(entry.assetId)
    }
    return props
  }, [sourceType, entry.assetId, entry.libraryEntryId])
  const {scale, lift} = useNormalizedModel(group)
  const objRef = useRef<ISheetObject<any> | undefined>(undefined)
  const [sheetObject, setSheetObject] = useState<ISheetObject<any> | undefined>(
    undefined,
  )
  const setObjRef = useCallback((obj: ISheetObject<any> | null) => {
    objRef.current = obj ?? undefined
    setSheetObject(obj ?? undefined)
  }, [])
  // 登记为落点表面:之后的放置可以把模型摞到这个模型上
  const groupRef = useRef<Group>(null!)
  usePlacementSurface(groupRef)
  // 登记为选中 gizmo 的附着目标:被选中时身上挂三轴移动箭头
  useSelectionGizmoTarget(objRef, groupRef)
  const invalidate = useThree((s) => s.invalidate)

  // 主画面点选:和 App 里 Model 的 selectThingy 同款。放置模式下点击是
  // 确认落点,不选中、不拦截;点 gizmo 箭头穿透过来的误点也要吞掉。
  const selectSelf = (event: ThreeEvent<MouseEvent>) => {
    if (selectLocked || isSelectSuppressed()) return
    event.stopPropagation()
    const studio = getStudioSync()
    if (studio && objRef.current) {
      studio.setSelection([objRef.current])
    }
  }

  // 右键:选中自己 + 弹操作菜单(切换手柄模式/删除)。
  // 放置模式下右键是取消放置(PlacementRig 的监听),这里不抢。
  const openMenu = (event: ThreeEvent<MouseEvent>) => {
    if (selectLocked || !onObjectMenu) return
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    const studio = getStudioSync()
    if (studio && objRef.current) {
      studio.setSelection([objRef.current])
    }
    onObjectMenu(
      entry.key,
      event.nativeEvent.clientX,
      event.nativeEvent.clientY,
    )
  }

  // 骨架动画:加载结果按 URL 缓存,同一文件放多个会共享同一份骨架,
  // 互相打架(多个 <primitive> 挂同一个 Object3D 也只有最后一个能显示)。
  // 所以每个实例克隆一份(SkinnedMesh 安全),配独立的 AnimationMixer。
  const instance = useMemo(() => SkeletonUtils.clone(group) as Group, [group])
  const mixer = useMemo(() => new AnimationMixer(instance), [instance])
  const bindPoseRef = useRef<PoseEntry['bones']>({})
  // 实例刚克隆出来时同步捕获绑定姿势,确保后续姿势应用 effect 运行前已就位
  useLayoutEffect(() => {
    bindPoseRef.current = captureBindPose(instance)
  }, [instance])
  const animationId = useVal(sheetObject?.props.animation) ?? ''
  const poseId = useVal(sheetObject?.props.pose) ?? ''
  const [clip, setClip] = useState<AnimationClip | null>(null)
  const [poseBones, setPoseBones] = useState<PoseEntry['bones'] | null>(null)
  const currentActionRef = useRef<AnimationAction | null>(null)
  const pendingUncachesRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  // 登记当前 theatre 对象与 PlacementEntry 的映射,App 用 selection 反查 rig;
  // 同时保留场景实例,供资产库面板统计引用与 Task 6 抽帧。
  useEffect(() => {
    if (!sheetObject) return
    placementObjects.set(sheetObject, {entry, instance})
    return () => {
      placementObjects.delete(sheetObject)
    }
  }, [sheetObject, entry, instance])

  // animation 属性变化时加载库动画 GLB
  useEffect(() => {
    if (!animationId) {
      setClip(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const animEntry = await getLibrary().backend.getEntry(animationId)
      if (!animEntry || animEntry.kind !== 'animation') {
        if (!cancelled) setClip(null)
        return
      }
      const url = await getLibrary().backend.getBlobUrl(animEntry.blobId)
      const gltf = await createGLTFLoader().loadAsync(url)
      if (!cancelled) {
        setClip(gltf.animations[0] ?? null)
      }
    }
    load().catch((err) => {
      console.warn('[placement] 动画加载失败', err)
      if (!cancelled) setClip(null)
    })
    return () => {
      cancelled = true
    }
  }, [animationId])

  // pose 属性变化时加载库姿势(内联 JSON,无 blob 加载)
  useEffect(() => {
    if (!poseId) {
      setPoseBones(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const poseEntry = await getLibrary().backend.getEntry(poseId)
      if (!cancelled) {
        setPoseBones(poseEntry?.kind === 'pose' ? poseEntry.bones : null)
      }
    }
    load().catch((err) => {
      console.warn('[placement] 姿势加载失败', err)
      if (!cancelled) setPoseBones(null)
    })
    return () => {
      cancelled = true
    }
  }, [poseId])

  // 动画片段切换:0.2s 淡入淡出
  useEffect(() => {
    if (!clip) {
      const oldAction = currentActionRef.current
      if (oldAction) {
        const oldClip = oldAction.getClip()
        oldAction.fadeOut(0.2)
        // 淡出结束再 uncache;立即 uncache 会中断淡出插值、骨骼瞬间回弹
        pendingUncachesRef.current.push(
          setTimeout(() => {
            const act = mixer.existingAction(oldClip, instance)
            if (act && act.isRunning()) return
            mixer.uncacheAction(oldClip, instance)
          }, 250),
        )
        currentActionRef.current = null
      }
      return
    }
    const oldAction = currentActionRef.current
    const oldClip = oldAction?.getClip()
    const action = mixer.clipAction(clip)
    action.reset().fadeIn(0.2).play()
    if (oldAction && oldAction !== action) {
      oldAction.fadeOut(0.2)
      if (oldClip) {
        // 同上:等淡出完成再清缓存,避免打断交叉淡化
        pendingUncachesRef.current.push(
          setTimeout(() => {
            const act = mixer.existingAction(oldClip, instance)
            if (act && act.isRunning()) return
            mixer.uncacheAction(oldClip, instance)
          }, 250),
        )
      }
    }
    currentActionRef.current = action
  }, [clip, mixer, instance])

  useEffect(() => {
    return () => {
      for (const t of pendingUncachesRef.current) clearTimeout(t)
      pendingUncachesRef.current = []
      mixer.stopAllAction()
      mixer.uncacheRoot(instance)
      disposeObjectTree(instance)
    }
  }, [mixer, instance])

  // 只在 theatre 序列播放时驱动动画:编辑/摆姿势时模型保持静止。
  // demand 帧循环下没有持续帧,播放状态翻成 true 时主动起一帧,
  // 之后 useFrame 里边播边续帧;暂停的那帧起不再 invalidate,画面静止。
  // 序列停止时把当前姿势(或绑定姿势)写回骨骼;播放时由 clip effect + useFrame 驱动,
  // animation 为空时 mixer 不更新,骨骼保持停止前的姿势,无需额外处理。
  // 旧的 action fadeOut 残余权重在停止后直接由 applyPose 覆盖,不必 stopAllAction。
  useEffect(() => {
    return onChange(sheet.sequence.pointer.playing, (playing) => {
      if (playing) {
        invalidate()
      } else {
        applyPose(instance, poseBones ?? bindPoseRef.current)
        invalidate()
      }
    })
  }, [sheet, invalidate, instance, poseBones])
  // pose 数据变化且当前未播放时立即应用,覆盖 poseId 切换与撤销/重做路径
  useEffect(() => {
    if (val(sheet.sequence.pointer.playing)) return
    applyPose(instance, poseBones ?? bindPoseRef.current)
    invalidate()
  }, [instance, poseBones, invalidate, sheet])
  useFrame((_, delta) => {
    if (!val(sheet.sequence.pointer.playing)) return
    mixer.update(delta)
    invalidate()
  })

  // pending 条目:对象已由 e.group 建好后,一次性提交清单。
  // 本地来源额外写 source 静态覆盖,让 theatre 项目状态引用到资产(避免被清理);
  // 库来源不写 source,清单里的 libraryEntryId 足够恢复。
  const isPending = 'pending' in entry && entry.pending
  useEffect(() => {
    if (!isPending) return
    const obj = objRef.current
    const studio = getStudioSync()
    if (!obj || !studio) return
    const registry = getRegistry(sheet)
    const list = readRegistry(registry)
    // 已在清单里 = 重做/同步/StrictMode 二次触发,不重复提交
    if (list.some((e) => e.key === entry.key)) return
    const scrub = studio.scrub()
    scrub.capture(({set}) => {
      const {pending: _pending, ...rest} = entry as PendingPlacementEntry
      set(registry.props.list, JSON.stringify([...list, rest]))
      if (sourceType === 'local' && entry.assetId) {
        set(
          obj.props.source as any,
          {
            type: 'file',
            id: entry.assetId,
          } as any,
        )
      }
    })
    scrub.commit()
    onPersisted()
  }, [])

  return (
    <e.group
      ref={groupRef}
      theatreKey={entry.key}
      objRef={setObjRef}
      additionalProps={additionalProps}
      position={[entry.position.x, entry.position.y, entry.position.z]}
      scale={scale}
      onClick={selectSelf}
      onContextMenu={openMenu}
    >
      <primitive object={instance} position={[0, lift, 0]} />
    </e.group>
  )
}

/** 本地缺资产(另一个客户端同步来的清单)或 FBX 解析失败时,跳过该模型而不是崩掉画布 */
class PlacedModelErrorBoundary extends React.Component<
  {
    entry: PlacementEntry | PendingPlacementEntry
    project: IProject
    sheet: ISheet
    onPersisted: () => void
    selectLocked?: boolean
    onObjectMenu?: (key: string, x: number, y: number) => void
  },
  {failed: boolean}
> {
  state = {failed: false}
  static getDerivedStateFromError() {
    return {failed: true}
  }
  componentDidCatch(err: unknown) {
    console.warn(`[placement] 模型 ${this.props.entry.key} 加载失败`, err)
  }
  render() {
    return this.state.failed ? null : <PlacedModel {...this.props} />
  }
}

/** gizmo 的三种操作模式 */
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export const GIZMO_MODE_LABELS: Record<GizmoMode, string> = {
  translate: '移动',
  rotate: '旋转',
  scale: '缩放',
}

/**
 * 快捷键切换 gizmo 模式(对齐 Blender):G 移动 / R 旋转 / S 缩放。
 * 有选中对象时才响应;焦点在输入框时不抢按键(和 studio 快捷键同一套避让)。
 * G 另有模态抓取(选中对象跟随鼠标,见 SelectionGizmo);R/S 只切模式。
 * 返回 [当前模式, 设置模式]——右键菜单也用设置接口切模式。
 */
export function useGizmoMode(): [GizmoMode, (mode: GizmoMode) => void] {
  const [mode, setMode] = useState<GizmoMode>('translate')
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      )
        return
      const next: GizmoMode | null =
        ev.code === 'KeyG'
          ? 'translate'
          : ev.code === 'KeyR'
            ? 'rotate'
            : ev.code === 'KeyS'
              ? 'scale'
              : null
      if (!next) return
      const studio = getStudioSync()
      if (!studio || studio.selection.length === 0) return
      setMode(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return [mode, setMode]
}

/** 顶部按钮旁的当前模式提示(兼作快捷键备忘) */
export function GizmoModeHint({mode}: {mode: GizmoMode}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        padding: '4px 10px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.55)',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 12,
        pointerEvents: 'none',
        userSelect: 'none',
        // 与镜头视角顶条同档:DOM 顺序上 Canvas 在更后面,不设层级会被画布盖住
        zIndex: 10,
      }}
    >
      手柄:{GIZMO_MODE_LABELS[mode]}(G 移动 · R 旋转 · S 缩放)
    </div>
  )
}

/**
 * 从放置清单里删除一个模型:一次 scrub 提交 = 一步撤销(撤销即模型回来)。
 * theatre 对象本身删不掉(公开 API 没有删除),会留个空壳在大纲里,
 * 刷新后消失——和撤销放置的已知行为一样。FBX 文件本体留在 IndexedDB。
 */
export function deletePlacement(sheet: ISheet, key: string) {
  const studio = getStudioSync()
  if (!studio) return
  const registry = getRegistry(sheet)
  const list = readRegistry(registry).filter((e) => e.key !== key)
  const scrub = studio.scrub()
  scrub.capture(({set}) => set(registry.props.list, JSON.stringify(list)))
  scrub.commit()
}

/**
 * 选中对象的操作手柄:studio 选中状态里出现登记过的对象时,
 * 在它的节点上挂手柄(移动三轴/旋转圆环/缩放方块,由 mode 决定);
 * 取消选中或选中别的,手柄消失。
 * (登记见 useSelectionGizmoTarget:已放置的模型、Thingy 都在表里)
 *
 * 拖动写回和拖相机同一套:按下开一个 scrub,拖动中逐帧 capture
 * (theatre 状态实时更新,属性面板/同步方都能看到),松手一次 commit
 * ——一次拖动 = 一步撤销。轨道控制器是 makeDefault,drei 的
 * TransformControls 拖动期间会自动禁用它,视角不会跟着转。
 */
export function SelectionGizmo({
  hidden,
  mode,
}: {
  hidden?: boolean
  mode: GizmoMode
}) {
  const [target, setTarget] = useState<{
    obj: ISheetObject<any>
    node: Object3D
  } | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  const scrubRef = useRef<IScrub | undefined>(undefined)
  const controlsRef = useRef<{detach?: () => void} | null>(null)
  // G 键模态抓取(Blender):选中对象跟随鼠标(过起点、正对相机的平面),
  // X/Y/Z 锁轴,左键/回车确认,右键/Esc 废弃弹回;和路径控制点共用一套
  const {start: startGrab, active: grabActive} = useModalGrab()

  useEffect(() => {
    const studio = getStudioSync()
    if (!studio) return
    const sync = () => {
      const selected = studio.selection.find((item) =>
        selectionGizmoTargets.has(item as ISheetObject<any>),
      ) as ISheetObject<any> | undefined
      setTarget(
        selected
          ? {obj: selected, node: selectionGizmoTargets.get(selected)!}
          : null,
      )
      invalidate()
    }
    sync()
    // 选中变化、登记表变化(路径驱动启用把相机注销了等)都重算附着目标
    gizmoRegistryListeners.add(sync)
    const untapSelection = studio.onSelectionChange(sync)
    return () => {
      gizmoRegistryListeners.delete(sync)
      untapSelection()
    }
  }, [invalidate])

  // G:对当前选中对象起模态抓取(写回 position;旋转/缩放的模态版暂无,
  // R/S 只切模式)。抓取平面/写回都是世界坐标,落属性时换算回节点本地
  useEffect(() => {
    if (hidden || !target) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== 'KeyG') return
      const el = ev.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return
      // 箭头拖动中途不抢
      if (scrubRef.current) return
      const {obj, node} = target
      startGrab({
        startPos: node.getWorldPosition(new Vector3()),
        dragging: false,
        capture: (scrub, worldPos) => {
          const local = worldPos.clone()
          const parent = node.parent
          if (parent) {
            parent.updateWorldMatrix(true, false)
            parent.worldToLocal(local)
          }
          scrub.capture(({set}) =>
            set(obj.props.position, {x: local.x, y: local.y, z: local.z}),
          )
        },
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden, target, startGrab])

  // 附着节点被移出场景(对象被删/卸载)时立刻摘掉手柄:否则 React
  // 重渲染前的空窗期里,helper 每帧更新都会撞 three 的
  // "The attached 3D object must be a part of the scene graph" 报错
  // (删选中的相机必现一次)。three 的 'removed' 事件和节点移除同步,
  // 比等选中通知→setState→重渲染快一个帧
  useEffect(() => {
    if (!target) return
    const node = target.node
    const detach = () => {
      controlsRef.current?.detach?.()
      setTarget((t) => (t && t.node === node ? null : t))
    }
    node.addEventListener('removed', detach)
    return () => node.removeEventListener('removed', detach)
  }, [target])

  // 卸载兜底:对象被撤销掉(节点已不在场景里)时不挂手柄;
  // 模态抓取期间也不挂:两套拖动不撞车(抓取结束后自动回来)
  if (hidden || !target || !target.node.parent || grabActive) return null
  return (
    <TransformControls
      ref={(controls: any) => {
        controlsRef.current = controls
        // 箭头本体登记为"仅编辑视角":画中画/镜头视角渲染时不入画。
        // three 0.185 的 TransformControls 不是 Object3D,可视部分在 getHelper()
        if (!controls) return
        const root: Object3D =
          typeof controls.getHelper === 'function'
            ? controls.getHelper()
            : controls
        return registerEditorOnly(root)
      }}
      object={target.node}
      mode={mode}
      onMouseDown={() => {
        suppressSelectBriefly()
        scrubRef.current = getStudioSync()?.scrub()
        invalidate()
      }}
      onObjectChange={() => {
        suppressSelectBriefly()
        invalidate()
        const scrub = scrubRef.current
        if (!scrub) return
        const node = target.node
        scrub.capture(({set}) => {
          // 旋转/缩放写回的是节点本地值:theatre 的 rotation/scale 属性
          // 本来就是本地空间,和面板里看到的数字一致
          if (mode === 'rotate') {
            const r = node.rotation
            set(target.obj.props.rotation, {x: r.x, y: r.y, z: r.z})
          } else if (mode === 'scale') {
            const s = node.scale
            set(target.obj.props.scale, {x: s.x, y: s.y, z: s.z})
          } else {
            const p = node.position
            set(target.obj.props.position, {x: p.x, y: p.y, z: p.z})
          }
        })
      }}
      onMouseUp={() => {
        suppressSelectBriefly()
        scrubRef.current?.commit()
        scrubRef.current = undefined
      }}
    />
  )
}
