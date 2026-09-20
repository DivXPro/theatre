// packages/playground/src/shared/camera/aimTargets.ts
/**
 * 瞄准/父级绑定的目标 id 方案与解析。
 * id 取值:''(无)| anchor:<key>(独立锚点)| bone:<placement>#<part>(骨骼锚点)
 *        | model:<placementKey>(整个放置模型)| camera:<cameraKey>(拍摄相机)。
 * 解析分两层:纯函数 resolveTargetObject(id, lookup) 供测试注入;
 * resolveAimTarget / resolveAnchorParent 读运行时登记表,供帧驱动调用。
 */
import {Matrix4} from 'three'
import type {Object3D, Vector3} from 'three'
import {translate} from '@dreamerbird/studio/i18n'
import {val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {
  getBoneAnchorObjects,
  makeBoneAnchorId,
  parseBoneAnchorId,
} from './boneAnchors'
import type {BonePart} from './boneAnchors'
import {getPlacedInstances, readPlacementEntries} from './PlacementManager'
import {
  cameraDisplayName,
  getCamerasRegistry,
  getShotCameraObjects,
  readCameraEntries,
} from './cameraRegistry'
import type {ISheet} from '@dreamerbird/core'
import {getAnchorsRegistry, readAnchorKeys} from './anchorsRegistry'

export type TargetKind = 'anchor' | 'bone' | 'model' | 'camera'

const KIND_PREFIXES: TargetKind[] = ['anchor', 'bone', 'model', 'camera']

export function parseTargetId(
  id: string,
):
  | {kind: 'anchor'; key: string}
  | {kind: 'bone'; placementKey: string; part: BonePart}
  | {kind: 'model'; key: string}
  | {kind: 'camera'; key: string}
  | null {
  if (id === '') return null
  const bone = parseBoneAnchorId(id)
  if (bone) return {kind: 'bone', ...bone}
  const colon = id.indexOf(':')
  if (colon <= 0) return null
  const kind = id.slice(0, colon) as TargetKind
  const key = id.slice(colon + 1)
  if (!KIND_PREFIXES.includes(kind) || !key) return null
  if (kind === 'bone') return null // 已被 parseBoneAnchorId 拦截,带 # 校验
  return {kind, key} as
    | {kind: 'anchor'; key: string}
    | {kind: 'model'; key: string}
    | {kind: 'camera'; key: string}
}

export function makeTargetId(
  kind: TargetKind,
  key: string,
  part?: BonePart,
): string {
  if (kind === 'bone') return makeBoneAnchorId(key, part!)
  return `${kind}:${key}`
}

/**
 * 只探测不创建:sheet.object 会把不存在的对象顺手建出来。顶层扁平化
 * (相机/模型不再套文件夹)后取名要与全场景对象防撞,靠它先问路径占用。
 * 探测不到/注册表未建一律 false(对齐 aimTargetOptions 的 privateAPI 用法)
 */
export function sheetObjectExists(sheet: ISheet, key: string): boolean {
  try {
    return Boolean((privateAPI(sheet) as any).getObject(key))
  } catch {
    return false
  }
}

export interface TargetLookup {
  anchors: ReadonlyMap<string, Object3D>
  bones: ReadonlyMap<string, Object3D>
  models: ReadonlyMap<string, Object3D>
  cameras: ReadonlyMap<string, Object3D>
}

export function resolveTargetObject(
  id: string,
  lookup: TargetLookup,
): Object3D | null {
  const parsed = parseTargetId(id)
  if (!parsed) return null
  switch (parsed.kind) {
    case 'anchor':
      return lookup.anchors.get(parsed.key) ?? null
    case 'bone':
      return (
        lookup.bones.get(makeBoneAnchorId(parsed.placementKey, parsed.part)) ??
        null
      )
    case 'model':
      return lookup.models.get(parsed.key) ?? null
    case 'camera':
      return lookup.cameras.get(parsed.key) ?? null
  }
}

/** 独立锚点的 theatreKey → 场景网格(Anchors 组件登记) */
const anchorObjects = new Map<string, Object3D>()

/**
 * 运行时目标登记表(锚点/相机,bones/placedInstances 在 Task 8 接线)
 * 的变更订阅:挂载登记/卸载注销时广播。ShotCamera 订阅后重渲染,
 * 持久态 aimTarget 指向的目标在目标挂载登记瞬间 tracking 立即翻正,
 * 不等到无关重渲染;目标被删同理即时回退自由朝向(规格§4)。
 */
const targetRegistryListeners = new Set<() => void>()

/** 订阅登记表变更,返回退订函数 */
export function subscribeTargetRegistry(fn: () => void): () => void {
  targetRegistryListeners.add(fn)
  return () => {
    targetRegistryListeners.delete(fn)
  }
}

/** 登记表变更广播;各 register/unregister 路径在写表后调用 */
export function notifyTargetRegistryChange(): void {
  for (const fn of targetRegistryListeners) fn()
}

export function registerAnchorObject(key: string, obj: Object3D | null): void {
  if (obj) anchorObjects.set(key, obj)
  else anchorObjects.delete(key)
  notifyTargetRegistryChange()
}

export function getAnchorObjects(): ReadonlyMap<string, Object3D> {
  return anchorObjects
}

export function defaultTargetLookup(): TargetLookup {
  return {
    anchors: anchorObjects,
    bones: getBoneAnchorObjects(),
    models: getPlacedInstances(),
    cameras: getShotCameraObjects(),
  }
}

export function resolveAimTarget(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}

export function resolveAnchorParent(id: string): Object3D | null {
  return resolveTargetObject(id, defaultTargetLookup())
}

/**
 * 「瞄准目标」下拉选项(模块级,studio 面板渲染时调用)。
 * 「无」+ 独立锚点(经 optionsSheet 读 Anchors 注册表,Task 6 落地,
 * 未落地前退化为空)+ 骨骼锚点(遍历运行时表,Task 8 接入数据)。
 */
let optionsSheet: ISheet | null = null
export function setAimOptionsSheet(sheet: ISheet | null): void {
  optionsSheet = sheet
}

export function aimTargetOptions(): {[key: string]: string} {
  const options: {[key: string]: string} = {'': translate('pg.props.aimNone')}
  if (!optionsSheet) return options
  try {
    for (const key of readAnchorKeys(getAnchorsRegistry(optionsSheet))) {
      options[makeTargetId('anchor', key)] = key
    }
  } catch {
    // Anchors 注册表尚未创建:跳过
  }
  // 骨骼锚点按模型分组:bone:<placement>#part → "<模型显示名> · <部位名>"
  const byPlacement = new Map<string, BonePart[]>()
  for (const id of getBoneAnchorObjects().keys()) {
    const parsed = parseBoneAnchorId(id)
    if (!parsed) continue
    const list = byPlacement.get(parsed.placementKey) ?? []
    list.push(parsed.part)
    byPlacement.set(parsed.placementKey, list)
  }
  for (const [placementKey, parts] of byPlacement) {
    const modelName = placementDisplayName(optionsSheet, placementKey)
    for (const part of parts) {
      options[makeTargetId('bone', placementKey, part)] =
        `${modelName} · ${translate(`pg.parts.${part}`)}`
    }
  }
  return options
}

/**
 * 「父级」下拉选项(锚点面板,按锚点 key 排除自己与后代防环)。
 * 候选:其他锚点 + 拍摄相机 + 放置模型 + 骨骼锚点。
 */
export function anchorParentOptionsFor(selfKey: string): {
  [key: string]: string
} {
  const options: {[key: string]: string} = {
    '': translate('pg.props.parentNone'),
  }
  if (!optionsSheet) return options
  const sheet = optionsSheet
  const parentOf = (key: string): string => {
    try {
      // 只探测不创建:sheet.object 会把不存在的对象顺手建出来
      // (对齐 CameraPath.pathExists 的 privateAPI 用法)
      const obj = (privateAPI(sheet) as any).getObject(key)
      return obj ? (val(obj.props.parent) as string | undefined) ?? '' : ''
    } catch {
      return ''
    }
  }
  try {
    for (const key of readAnchorKeys(getAnchorsRegistry(sheet))) {
      if (key === selfKey) continue
      if (isDescendantAnchor(selfKey, key, parentOf)) continue
      options[makeTargetId('anchor', key)] = key
    }
  } catch {
    // 注册表未建
  }
  try {
    for (const entry of readCameraEntries(getCamerasRegistry(sheet))) {
      options[makeTargetId('camera', entry.cameraKey)] = cameraDisplayName(
        entry.cameraKey,
      )
    }
  } catch {
    // 相机注册表未建
  }
  try {
    for (const entry of readPlacementEntries(sheet)) {
      options[makeTargetId('model', entry.key)] = entry.key.replace(
        /^Models \/ /,
        '',
      )
    }
  } catch {
    // 放置注册表未建
  }
  // 骨骼锚点(分组同 aimTargetOptions)
  const byPlacement = new Map<string, BonePart[]>()
  for (const id of getBoneAnchorObjects().keys()) {
    const parsed = parseBoneAnchorId(id)
    if (!parsed) continue
    const list = byPlacement.get(parsed.placementKey) ?? []
    list.push(parsed.part)
    byPlacement.set(parsed.placementKey, list)
  }
  for (const [placementKey, parts] of byPlacement) {
    const modelName = placementDisplayName(sheet, placementKey)
    for (const part of parts) {
      options[makeTargetId('bone', placementKey, part)] =
        `${modelName} · ${translate(`pg.parts.${part}`)}`
    }
  }
  return options
}

/** 环检测:candidate 沿父链向上能否到达 selfKey(candidate 是 self 的后代) */
export function isDescendantAnchor(
  selfKey: string,
  candidateKey: string,
  parentOf: (key: string) => string,
): boolean {
  let cur = parentOf(candidateKey)
  let guard = 0
  while (cur && guard++ < 100) {
    if (cur === `anchor:${selfKey}`) return true
    const parsed = parseTargetId(cur)
    cur = parsed && parsed.kind === 'anchor' ? parentOf(parsed.key) : ''
  }
  return false
}

/** 世界坐标 → 父级局部偏移(纯函数,绑定/解绑定格用) */
export function localOffsetForParent(
  childWorld: Vector3,
  parentObj: Object3D,
  out: Vector3,
): Vector3 {
  parentObj.updateWorldMatrix(true, false)
  const inv = new Matrix4().copy(parentObj.matrixWorld).invert()
  return out.copy(childWorld).applyMatrix4(inv)
}

/**
 * 锚点卸载时脱离命令式父级(骨骼/模型上的锚点被删的清理)。
 * fiber v9 卸载按 JSX 父实例 remove,对换父后的网格是 no-op,不脱离会
 * 残留在场景里,可见不可选,绑骨骼上还会跟随动画。
 * 注意:passive useEffect cleanup 执行时 React 已把 ref 置 null
 * (实测 React 19.2.8,layout cleanup 才保有),调用方必须在 effect
 * 体内捕获 mesh 传进来。
 */
export function detachAnchorMesh(mesh: Object3D | null): void {
  mesh?.removeFromParent()
}

/**
 * 绑定重试循环的判定:有父级目标、且本会话尚未对当前 parentId 绑定
 * 成功。刷新/撤销恢复的持久绑定在异步目标(放置模型/骨骼锚点,
 * Suspense 加载完才注册)就绪前一直满足本条件,由 useFrame 每帧补建;
 * 建立成功后写入 boundParentId,不再重试。
 */
export function needsParentEstablish(
  boundParentId: string | null,
  parentId: string,
): boolean {
  return parentId !== '' && boundParentId !== parentId
}

/**
 * 父级消失看护的清除判定:本会话曾对当前 parentId 绑定成功、且此刻
 * 解析不到 → 允许「清除 parent + 定格世界坐标」。从未绑定成功过的
 * 父级(刷新恢复/加载中)判 false:不清不定格,交给重试循环直到建立
 * ——否则异步目标加载完成前的空窗会被误当「父级消失」,持久绑定被清掉。
 */
export function shouldClearMissingParent(
  boundParentId: string | null,
  parentId: string,
  resolvable: boolean,
): boolean {
  return parentId !== '' && boundParentId === parentId && !resolvable
}

/** 从放置注册表反查模型显示名;放置注册表未建好时回退原 key */
function placementDisplayName(sheet: ISheet, placementKey: string): string {
  try {
    const entry = readPlacementEntries(sheet).find(
      (e) => e.key === placementKey,
    )
    if (entry) return entry.key.replace(/^Models \/ /, '')
  } catch {
    // 放置注册表尚未创建
  }
  return placementKey
}
