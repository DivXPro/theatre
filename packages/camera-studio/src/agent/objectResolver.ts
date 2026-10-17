/**
 * Agent 场景对象 resolver(2026-10-17,Task 4):无副作用是核心契约。
 *
 * 存在性底账 = 四个业务注册表(Placements/Cameras/Anchors/Paths),
 * 只用 privateAPI(sheet).getObject(registryKey) 探测 —— 注册表对象
 * 不存在时按空清单算,绝不创建;也绝不调用 sheet.object / getPathMeta /
 * readPathPoints(它们会顺手创建对象)。
 *
 * 业务 ID 的 key 分别来自 placement key、cameraKey、anchorKey、pathKey,
 * 但不假定这些 key 能绕过运行时直接构造 SheetObject:运行时对象一律经
 * objectRuntime 登记读取。注册表有条目但运行时未挂载时返回
 * props:null, mounted:false,而不是误报 OBJECT_NOT_FOUND
 * (后续写命令对此返回 INVALID_STATE)。
 */
import {val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {ANCHORS_REGISTRY_KEY, parseAnchorKeys} from '../anchorsRegistry'
import {CAMERAS_REGISTRY_KEY, parseCameraEntries} from '../cameraRegistry'
import {PATHS_REGISTRY_KEY, parsePathEntries} from '../pathRegistry'
import {PLACEMENTS_REGISTRY_KEY, readRegistry} from '../PlacementManager'
import {AgentApiError} from './errors'
import {formatSceneObjectId, parseSceneObjectId} from './objectIds'
import {getSceneSheetObject} from './runtime/objectRuntime'
import type {SceneObjectId, SceneObjectKind} from './types'

/** 场景对象摘要(spec 8.4/9):带类型 ID + 当前求值属性 + 挂载状态 */
export type SceneObjectSummary = {
  id: SceneObjectId
  kind: SceneObjectKind
  key: string
  /** 已挂载:SheetObject 当前求值属性的深拷贝;未挂载:null */
  props: Record<string, unknown> | null
  /** 运行时 SheetObject 已登记(资源加载状态由领域 handler 另行上报) */
  mounted: boolean
}

/** 场景快照:revision 与对象清单(无副作用) */
export type SceneSnapshot = {
  revision: number
  objects: SceneObjectSummary[]
}

type RegistrySource = {
  kind: SceneObjectKind
  registryKey: string
  keysFrom: (registry: ISheetObject<any>) => string[]
}

const sources: readonly RegistrySource[] = [
  {
    kind: 'model',
    registryKey: PLACEMENTS_REGISTRY_KEY,
    keysFrom: (registry) => readRegistry(registry).map((entry) => entry.key),
  },
  {
    kind: 'camera',
    registryKey: CAMERAS_REGISTRY_KEY,
    keysFrom: (registry) =>
      parseCameraEntries(val(registry.props.list) as string).map(
        (entry) => entry.cameraKey,
      ),
  },
  {
    kind: 'anchor',
    registryKey: ANCHORS_REGISTRY_KEY,
    keysFrom: (registry) => parseAnchorKeys(val(registry.props.list) as string),
  },
  {
    kind: 'path',
    registryKey: PATHS_REGISTRY_KEY,
    keysFrom: (registry) =>
      parsePathEntries(val(registry.props.list) as string).map(
        (entry) => entry.pathKey,
      ),
  },
]

/**
 * 只探测不创建:内部对象表里没有就返回 undefined。
 * getObject 返回的是内部 SheetObject,经 publicApi 拿公开门面再读 props。
 */
function peekRegistry(
  sheet: ISheet,
  registryKey: string,
): ISheetObject<any> | undefined {
  const internal = (privateAPI(sheet) as any).getObject(registryKey)
  return (internal?.publicApi ?? undefined) as ISheetObject<any> | undefined
}

function sourceFor(kind: SceneObjectKind): RegistrySource {
  return sources.find((source) => source.kind === kind)!
}

/** 某类业务对象的全量 key;注册表未创建时为空(不创建) */
export function listSceneObjectKeys(
  sheet: ISheet,
  kind: SceneObjectKind,
): string[] {
  const source = sourceFor(kind)
  const registry = peekRegistry(sheet, source.registryKey)
  return registry ? source.keysFrom(registry) : []
}

/** theatre 的值层保证可序列化,JSON 往返即深拷贝(防调用方改返回值污染场景) */
function deepCopyProps(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>
}

function summarize(kind: SceneObjectKind, key: string): SceneObjectSummary {
  const id = formatSceneObjectId(kind, key)
  const obj = getSceneSheetObject(id)
  return {
    id,
    kind,
    key,
    props: obj ? deepCopyProps(obj.value) : null,
    mounted: Boolean(obj),
  }
}

/** 全场景对象清单(无副作用) */
export function listSceneObjects(sheet: ISheet): SceneObjectSummary[] {
  return sources.flatMap((source) =>
    listSceneObjectKeys(sheet, source.kind).map((key) =>
      summarize(source.kind, key),
    ),
  )
}

/**
 * 单个对象摘要。ID 前缀非法抛 INVALID_ID_KIND;注册表里没有抛
 * OBJECT_NOT_FOUND(details 含 objectId 和 kind);有条目但未挂载返回
 * props:null, mounted:false。
 */
export function getSceneObjectSummary(
  sheet: ISheet,
  objectId: string,
): SceneObjectSummary {
  const {kind, key} = parseSceneObjectId(objectId)
  if (!listSceneObjectKeys(sheet, kind).includes(key)) {
    throw new AgentApiError('OBJECT_NOT_FOUND', `场景对象不存在: ${objectId}`, {
      details: {objectId, kind},
    })
  }
  return summarize(kind, key)
}

/**
 * 解析业务 ID 到当前挂载的 SheetObject(未挂载返回 undefined)。
 * expectedKind 用于领域命令的类型约束:类型不匹配抛 INVALID_ID_KIND
 * (spec 8.4:解析时同时校验类型和存在性)。
 */
export function resolveSceneSheetObject(
  sheet: ISheet,
  objectId: string,
  expectedKind?: SceneObjectKind,
): ISheetObject<any> | undefined {
  const {kind, key} = parseSceneObjectId(objectId)
  if (expectedKind && kind !== expectedKind) {
    throw new AgentApiError(
      'INVALID_ID_KIND',
      `对象 ${objectId} 的类型是 ${kind},此处需要 ${expectedKind}`,
      {details: {objectId, kind, expectedKind}},
    )
  }
  if (!listSceneObjectKeys(sheet, kind).includes(key)) {
    throw new AgentApiError('OBJECT_NOT_FOUND', `场景对象不存在: ${objectId}`, {
      details: {objectId, kind},
    })
  }
  return getSceneSheetObject(formatSceneObjectId(kind, key))
}
