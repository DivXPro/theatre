/**
 * 路径领域命令(2026-10-17,Task 11):预设创建、控制点读改写、
 * 进度锚点和整路径删除的纯领域实现,供 `paths.*` 命令、CameraScene UI
 * 和 Task 14 的 objects.delete 共用(preflight ruling:deletePathDomain
 * 的家在这里,UI 不做领域所有者)。
 *
 * 约定:
 * - 名单读改写一律 parsePathPoints → pathModel 纯函数变换 →
 *   serializePathPoints,写入是单个 studio.transaction(一个命令一个
 *   撤销步骤);回调同步,不跨 await。
 * - `points` 是领域专属属性(propAccess.domainOwnedProps):写前先做
 *   建轨预检(isPropSequenced),已建轨抛 INVALID_STATE——与
 *   cameras/poses 的 domainOwned 写入同一 ruling。
 * - beforeWrite 钩子:所有校验(点存在/建轨)之后、第一个历史写入之前
 *   调用,命令层用它挂 expectedRevision 检查(先校验后 revision,
 *   revision 先于任何副作用——同 cameras 的 writeCameraStaticProp 排序)。
 * - 写路径允许落实 meta 句柄(getPathMeta);路径在注册表=对象必然
 *   存在或允许创建(mutation 语义)。查询不走这里。
 */
import {getStudioSync, val} from '@dreamerbird/core'
import type {ISheet, ISheetObject, IStudio} from '@dreamerbird/core'
import {Vector3} from 'three'
import {getPathMeta, pathExists} from '../CameraPath'
import {
  getPathsRegistry,
  nextPathEntry,
  readPathEntries,
  removePathFromRegistry,
} from '../pathRegistry'
import type {BoundCameraReset} from '../pathRegistry'
import {getCamerasRegistry, readCameraEntries} from '../cameraRegistry'
import {resolveBoundPathKey} from '../pathBinding'
import {
  buildCurve,
  extendPathPoint,
  nextPointKey,
  parsePathPoints,
  serializePathPoints,
  withDraggedHandle,
  withMovedPoint,
  withMovedU,
  withResetU,
} from '../pathModel'
import type {PathPointEntry, Vec3Like} from '../pathModel'
import {findFreeSpot, presetPlacement} from '../pathPresets'
import type {PathPreset} from '../pathPresets'
import {readPlacementPositions} from '../PlacementManager'
import {isPropSequenced} from './propAccess'
import {AgentApiError} from './errors'
import {formatSceneObjectId} from './objectIds'
import {getSceneSheetObject} from './runtime/objectRuntime'
import {getPathSampler} from './runtime/pathRuntime'

/** Studio 不可用 = SCENE_UNAVAILABLE(spec 8.3:静默 return 不得翻译成成功) */
function requireStudio(): IStudio {
  const studio = getStudioSync()
  if (!studio) {
    throw new AgentApiError('SCENE_UNAVAILABLE', 'Studio 不可用,无法写入路径')
  }
  return studio
}

/** points 建轨预检:已建轨的名单写入会落成关键帧,拒绝(改用 keyframes.*) */
function assertPointsStatic(meta: ISheetObject<any>, pathKey: string): void {
  if (isPropSequenced(meta, 'points')) {
    throw new AgentApiError(
      'INVALID_STATE',
      `路径 ${pathKey} 的控制点已建轨,拒绝静态写入`,
      {details: {pathKey, prop: 'points'}},
    )
  }
}

/** 单事务写名单(+ 可选同事务额外写入);调用前必须完成全部校验 */
function commitPoints(
  studio: IStudio,
  meta: ISheetObject<any>,
  entries: PathPointEntry[],
  extra?: (set: (prop: any, value: any) => void) => void,
): void {
  studio.transaction(({set}) => {
    set(meta.props.points, serializePathPoints(entries))
    extra?.(set)
  })
}

function pointNotFound(pathKey: string, pointKey: string): AgentApiError {
  return new AgentApiError(
    'PATH_POINT_NOT_FOUND',
    `路径 ${pathKey} 没有控制点 ${pointKey}`,
    {details: {pathKey, pointKey}},
  )
}

/**
 * 预设创建:注册表取下一个可用 key → 同名孤儿(对象带旧点/已建轨)
 * 先真删(同 UI placePresetPath 的教训:不删会被当既有路径延伸) →
 * 一个事务同时写 meta points(局部坐标,P1..Pn)、position(落点)和
 * Paths 注册表清单 = 一步撤销。
 *
 * center 由命令层算好(显式 at 或 findFreeSpot 避让结果)。
 */
export function createPresetPath(
  sheet: ISheet,
  preset: PathPreset,
  center: Vec3Like,
  beforeWrite?: () => void,
): {pathKey: string; pointKeys: string[]} {
  const studio = requireStudio()
  const registry = getPathsRegistry(sheet)
  const entry = nextPathEntry(readPathEntries(registry))
  const orphanMeta = getPathMeta(sheet, entry.pathKey)
  const orphan =
    parsePathPoints(orphanMeta.value.points).length > 0 ||
    isPropSequenced(orphanMeta, 'points')
  // 校验与探测完毕;revision 检查先于孤儿删除和播种这两个副作用
  beforeWrite?.()
  if (orphan) {
    removePathFromRegistry(sheet, entry)
  }
  const meta = getPathMeta(sheet, entry.pathKey)
  // 落点 = 路径原点:控制点存相对落点的局部坐标,位置变换在同一次提交里
  const {points, position} = presetPlacement(preset, center)
  const entries: PathPointEntry[] = points.map((p, i) => ({
    key: `P${i + 1}`,
    position: {x: p.x, y: p.y, z: p.z},
  }))
  const list = readPathEntries(registry)
  commitPoints(studio, meta, entries, (set) => {
    set(meta.props.position, {x: position.x, y: position.y, z: position.z})
    set(registry.props.list, JSON.stringify([...list, entry]))
  })
  return {pathKey: entry.pathKey, pointKeys: entries.map((e) => e.key)}
}

/**
 * 默认落点:findFreeSpot 避开已放置模型和已有路径的原点,基点原点
 * (高度语义属 UI 的取景便利,Agent 命令默认落地面原点;要精确落点
 * 传显式 at)。
 */
export function defaultPresetSpot(sheet: ISheet): Vec3Like {
  const occupied: Vec3Like[] = [...readPlacementPositions(sheet)]
  for (const entry of readPathEntries(getPathsRegistry(sheet))) {
    if (!pathExists(sheet, entry.pathKey)) continue
    const position = val(getPathMeta(sheet, entry.pathKey).props.position) as
      | Vec3Like
      | undefined
    if (position) occupied.push(position)
  }
  return findFreeSpot(occupied)
}

/** 加点:沿最后一段方向延伸等长一段;空名单拒绝(没点就不出现) */
export function addPathPointDomain(
  sheet: ISheet,
  pathKey: string,
  beforeWrite?: () => void,
): {pointKey: string} {
  const studio = requireStudio()
  const meta = getPathMeta(sheet, pathKey)
  const entries = parsePathPoints(meta.value.points)
  if (entries.length === 0) {
    throw new AgentApiError(
      'INVALID_STATE',
      `路径 ${pathKey} 没有控制点,无法延伸;请用 paths.createPreset 播种`,
      {details: {pathKey}},
    )
  }
  assertPointsStatic(meta, pathKey)
  const pointKey = nextPointKey(entries)
  const position = extendPathPoint(entries)
  beforeWrite?.()
  commitPoints(studio, meta, [...entries, {key: pointKey, position}])
  return {pointKey}
}

/**
 * 改控制点:position 整体替换(局部坐标),handle 拖一侧
 * (withDraggedHandle 对齐规则:被拖侧取新偏移,另一侧共线镜像,
 * 与 UI 手柄拖动同一纯函数)。两者可同一次给出 = 一个事务。
 */
export function updatePathPointDomain(
  sheet: ISheet,
  pathKey: string,
  pointKey: string,
  patch: {
    position?: Vec3Like
    handle?: {side: 'left' | 'right'; offset: Vec3Like}
  },
  beforeWrite?: () => void,
): void {
  const studio = requireStudio()
  const meta = getPathMeta(sheet, pathKey)
  const entries = parsePathPoints(meta.value.points)
  if (!entries.some((e) => e.key === pointKey)) {
    throw pointNotFound(pathKey, pointKey)
  }
  assertPointsStatic(meta, pathKey)
  let next = entries
  if (patch.position) next = withMovedPoint(next, pointKey, patch.position)
  if (patch.handle) {
    next = withDraggedHandle(
      next,
      pointKey,
      patch.handle.side,
      patch.handle.offset,
    )
  }
  beforeWrite?.()
  commitPoints(studio, meta, next)
}

/**
 * 调进度锚点:内部点写显式 u(withMovedU 夹到相邻锚点之间,保住单调,
 * 与 UI 数值浮条同一纯函数);u:null = 清掉显式锚点恢复自动(弧长等比)。
 * 首尾点恒为 0/1,显式设置/恢复都拒绝。
 */
export function setPathPointTimingDomain(
  sheet: ISheet,
  pathKey: string,
  pointKey: string,
  u: number | null,
  beforeWrite?: () => void,
): void {
  const studio = requireStudio()
  const meta = getPathMeta(sheet, pathKey)
  const entries = parsePathPoints(meta.value.points)
  const idx = entries.findIndex((e) => e.key === pointKey)
  if (idx < 0) throw pointNotFound(pathKey, pointKey)
  if (idx === 0 || idx === entries.length - 1) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `首尾控制点的进度锚点固定为 0/1,只有内部点可调: ${pointKey}`,
      {details: {pathKey, pointKey}},
    )
  }
  assertPointsStatic(meta, pathKey)
  const next =
    u === null
      ? withResetU(entries, pointKey)
      : withMovedU(entries, pointKey, u, buildCurve(entries))
  beforeWrite?.()
  commitPoints(studio, meta, next)
}

/**
 * 删除路径前收集绑定它的相机(连同机位定格),折进清单移除的同一个
 * scrub 回退——撤销删除时清单行/绑定/机位一起还原,不留"绑定还在但
 * 路径没了"的中间态(见 pathRegistry.removePathFromRegistry 的撤销陷阱
 * 注释)。
 *
 * 与 CameraScene.collectBoundCameraResets 同语义,数据源换成 Agent
 * 运行时:相机 SheetObject 来自 objectRuntime(ShotCamera 登记),
 * 定格采样来自 pathRuntime(CameraPath 登记);路径未挂载(无采样器)
 * 或没点 = 没被驱动过,只清绑定不定格。
 */
export function collectBoundCamerasForPath(
  sheet: ISheet,
  pathKey: string,
): BoundCameraReset[] {
  const registeredKeys = readPathEntries(getPathsRegistry(sheet)).map(
    (e) => e.pathKey,
  )
  let freeze: Vec3Like | null = null
  const sampler = getPathSampler(pathKey)
  if (sampler && pathExists(sheet, pathKey)) {
    const meta = getPathMeta(sheet, pathKey)
    if (parsePathPoints(meta.value.points).length > 0) {
      const progress = (val(meta.props.progress) as number | undefined) ?? 0
      const tmp = new Vector3()
      if (sampler(progress, tmp)) {
        freeze = {x: tmp.x, y: tmp.y, z: tmp.z}
      }
    }
  }
  const resets: BoundCameraReset[] = []
  for (const entry of readCameraEntries(getCamerasRegistry(sheet))) {
    const obj = getSceneSheetObject(
      formatSceneObjectId('camera', entry.cameraKey),
    )
    if (!obj) continue
    const bound = (val(obj.props.pathKey) as string | undefined) ?? ''
    if (resolveBoundPathKey(bound, registeredKeys) !== pathKey) continue
    resets.push({obj, freeze})
  }
  return resets
}

/**
 * 删除整条路径(preflight ruling:领域函数的家在 agent 层,CameraScene
 * UI、最后一点删除和 Task 14 的 objects.delete 都调这里):
 * forgetObject 清持久数据 + 注册表移除 + 绑定相机回退(定格机位/清
 * 绑定)合并为单个事务 = 一步撤销(2026-10-19,Task 14 合并,见
 * removePathFromRegistry);detachObject 显式脱离是非 historic 清理,
 * 放在事务之后。
 *
 * boundCameras 缺省时按 Agent 运行时登记现收集;CameraScene 传入自己
 * 按 refs 收集的结果(既有 UI 行为逐行保留)。
 */
export function deletePathDomain(
  sheet: ISheet,
  pathKey: string,
  options: {boundCameras?: BoundCameraReset[]} = {},
): void {
  requireStudio()
  const boundCameras =
    options.boundCameras ?? collectBoundCamerasForPath(sheet, pathKey)
  removePathFromRegistry(sheet, {pathKey}, boundCameras)
}

/**
 * 删控制点:非最后一点只更新名单(一步撤销);删掉最后一个点 = 删除
 * 整条路径("没点就不出现",走 deletePathDomain 的完整清理)。
 */
export function deletePathPointDomain(
  sheet: ISheet,
  pathKey: string,
  pointKey: string,
  beforeWrite?: () => void,
): {pathDeleted: boolean} {
  const studio = requireStudio()
  const meta = getPathMeta(sheet, pathKey)
  const entries = parsePathPoints(meta.value.points)
  if (!entries.some((e) => e.key === pointKey)) {
    throw pointNotFound(pathKey, pointKey)
  }
  if (entries.length <= 1) {
    beforeWrite?.()
    deletePathDomain(sheet, pathKey)
    return {pathDeleted: true}
  }
  assertPointsStatic(meta, pathKey)
  beforeWrite?.()
  commitPoints(
    studio,
    meta,
    entries.filter((e) => e.key !== pointKey),
  )
  return {pathDeleted: false}
}
