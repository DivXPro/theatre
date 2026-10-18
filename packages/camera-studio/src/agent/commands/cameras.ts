/**
 * cameras 命令(2026-10-17,Task 10):create / setActive / setAimTarget /
 * bindPath / unbindPath。
 *
 * create 执行顺序:assertActive → expectedRevision 乐观并发(先于任何
 * 副作用)→ Scene Runtime createCamera handler(未绑定
 * SCENE_UNAVAILABLE;生产由 CameraScene 绑定,fromCurrentView 的种子
 * 由它从导演视角捕获)→ 创建挂载 waiter 并等 ShotCamera 的种子 layout
 * effect 通知(completion:mounted;期间 dispose 优先映射 API_DISPOSED,
 * 其余拒绝 INTERNAL_ERROR)→ resolver 复核注册表与 SheetObject 双双
 * 可见(脱节 = INTERNAL_ERROR,不静默成功)。
 *
 * setActive 是会话命令(stateDomain:session,undoable:none):经 Scene
 * Runtime 的 setActiveCamera handler 改 CameraScene 会话态,只校验 key
 * 仍在 Cameras 注册表,不要求已挂载,不进项目历史。
 *
 * setAimTarget / bindPath / unbindPath 是领域静态写入(preflight
 * ruling):aimTarget/pathKey 属 domainOwnedProps,命令完成自身校验
 * (目标存在性/类型)与建轨预检后写入;已建轨返回 INVALID_STATE,
 * 打帧由 keyframes.* 显式进行。
 *
 * 解除类写入(unbindPath、setAimTarget 目标为 '')把坐标定格折进同一
 * 事务(2026-10-19,F1 修复):原实现只写属性,ShotCamera 的看护 effect
 * 再补一笔定格提交——两步撤销,undo 一次只回属性不回定格,相机跳变
 * (撤销陷阱)。现在事务内同写属性+position/rotation 定格,看护的
 * 同值守卫看到 persisted==定格值即跳过提交,一步撤销。
 *
 * 瞄准目标与 UI 下拉同集(stringLiteral 字面量):''(解除)+
 * anchor:<key> + bone:<placement>#<part>;其余类型 ID 拒绝
 * (INVALID_ARGUMENT),无前缀/坏骨骼部位 INVALID_ID_KIND。
 */
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {Euler, Matrix4, Vector3} from 'three'
import {formatSceneObjectId, parseSceneObjectId} from '../objectIds'
import {
  getSceneObjectSummary,
  listSceneObjectKeys,
  resolveSceneSheetObject,
} from '../objectResolver'
import {
  assertStaticPropsWritable,
  setStaticPropsWithFreeze,
} from '../propAccess'
import {createCameraWaiter} from '../runtime/cameraLifecycle'
import {getSceneSheetObject} from '../runtime/objectRuntime'
import {getPathSampler} from '../runtime/pathRuntime'
import type {JsonSchema, SceneObjectId, Vec3} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'
import {parseTargetId, resolveAimTarget} from '../../aimTargets'
import {getShotCameraObjects} from '../../cameraRegistry'
import type {CameraSeed} from '../../cameraRegistry'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 创建相机(CameraScene 绑定,转发 addCameraToRegistry):同步生成
     * key、写注册表清单、stash 取景种子,立即返回;seed 缺省时由
     * CameraScene 从当前导演视角捕获(captureCameraSeed)。挂载完成经
     * cameraLifecycle.notifyCameraReady 通知。
     */
    createCamera(args: {seed?: CameraSeed}): {key: string}
    /**
     * 设置活动相机(CameraScene 绑定,转发 setActiveCameraKey):
     * 会话态,不进项目历史;key 的存在性由命令侧先校验。
     */
    setActiveCamera(args: {cameraKey: string}): void
  }
}

/** 相机门面(Task 15 由同名命令转发实现) */
export type CamerasApi = {
  create(args: {
    fromCurrentView?: boolean
    transform?: {position: Vec3; rotation: Vec3}
    expectedRevision?: number
  }): Promise<{objectId: SceneObjectId; revision: number}>
  setActive(args: {objectId: SceneObjectId}): Promise<void>
  setAimTarget(args: {
    objectId: SceneObjectId
    target: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  bindPath(args: {
    objectId: SceneObjectId
    pathId: SceneObjectId
    expectedRevision?: number
  }): Promise<{revision: number}>
  unbindPath(args: {
    objectId: SceneObjectId
    expectedRevision?: number
  }): Promise<{revision: number}>
}

type CreateArgs = {
  fromCurrentView?: boolean
  transform?: {position: Vec3; rotation: Vec3}
  expectedRevision?: number
}
type SetActiveArgs = {objectId: string}
type SetAimTargetArgs = {
  objectId: string
  target: string
  expectedRevision?: number
}
type BindPathArgs = {
  objectId: string
  pathId: string
  expectedRevision?: number
}
type UnbindPathArgs = {objectId: string; expectedRevision?: number}

const vec3Schema: JsonSchema = {
  type: 'object',
  properties: {
    x: {type: 'number'},
    y: {type: 'number'},
    z: {type: 'number'},
  },
  required: ['x', 'y', 'z'],
  additionalProperties: false,
}

const expectedRevisionProperty: JsonSchema = {
  type: 'number',
  description: '乐观并发:读取场景时的 revision',
}

const objectIdProperty: JsonSchema = {
  type: 'string',
  description: '带类型场景对象 ID,camera:<key>',
}

const createInput: JsonSchema = {
  type: 'object',
  properties: {
    fromCurrentView: {
      type: 'boolean',
      description: 'true = 以当前导演视角的机位/朝向为种子',
    },
    transform: {
      type: 'object',
      properties: {
        position: {...vec3Schema, description: '机位(世界坐标)'},
        rotation: {...vec3Schema, description: '朝向(XYZ 欧拉角,弧度)'},
      },
      required: ['position', 'rotation'],
      additionalProperties: false,
      description: '显式初始机位/朝向;与 fromCurrentView 互斥',
    },
    expectedRevision: expectedRevisionProperty,
  },
  additionalProperties: false,
}

const createOutput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {type: 'string', description: '带类型场景对象 ID,camera:<key>'},
    revision: {type: 'number'},
  },
  required: ['objectId', 'revision'],
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

const voidOutput: JsonSchema = {type: 'object', additionalProperties: false}

function optionalExpectedRevision(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, 'expectedRevision')
}

function validateCreate(value: unknown): CreateArgs {
  const args = requireObject(value)
  let fromCurrentView: boolean | undefined
  if (args.fromCurrentView !== undefined) {
    if (typeof args.fromCurrentView !== 'boolean') {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        'fromCurrentView 必须是布尔值',
      )
    }
    fromCurrentView = args.fromCurrentView
  }
  let transform: {position: Vec3; rotation: Vec3} | undefined
  if (args.transform !== undefined) {
    const raw = requireObject(args.transform)
    transform = {
      position: requireVec3(raw.position, 'transform.position'),
      rotation: requireVec3(raw.rotation, 'transform.rotation'),
    }
  }
  if (fromCurrentView && transform) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      'fromCurrentView 与 transform 互斥,二选一',
    )
  }
  if (!fromCurrentView && !transform) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      '需要 fromCurrentView:true 或显式 transform',
    )
  }
  return {
    fromCurrentView,
    transform,
    expectedRevision: optionalExpectedRevision(args.expectedRevision),
  }
}

/** 解析相机对象:类型不符 INVALID_ID_KIND、不存在 OBJECT_NOT_FOUND、未挂载 INVALID_STATE */
function resolveMountedCamera(runtime: AgentRuntime, objectId: string) {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId, 'camera')
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `相机已登记但尚未挂载,无法操作: ${objectId}`,
      {details: {objectId}},
    )
  }
  return sheetObject
}

/** 注册表存在性底账(只探测不创建);缺失 OBJECT_NOT_FOUND */
function assertRegistryHasKey(
  sheet: ISheet,
  kind: 'model' | 'camera' | 'anchor' | 'path',
  key: string,
  label: string,
): void {
  if (!listSceneObjectKeys(sheet, kind).includes(key)) {
    throw new AgentApiError(
      'OBJECT_NOT_FOUND',
      `${label}不存在: ${kind}:${key}`,
      {details: {objectId: formatSceneObjectId(kind, key), kind}},
    )
  }
}

/**
 * 瞄准目标校验:'' = 解除;anchor:<key> 要求在 Anchors 注册表;
 * bone:<placement>#<part> 要求放置模型在册(部位格式由 parseTargetId
 * 校验)。与 UI 下拉同集,其余类型拒绝。只校验不写 props。
 */
function assertAimTargetValid(sheet: ISheet, target: string): void {
  if (target === '') return
  const parsed = parseTargetId(target)
  if (!parsed) {
    throw new AgentApiError('INVALID_ID_KIND', `无效瞄准目标 ID: ${target}`, {
      details: {target},
    })
  }
  switch (parsed.kind) {
    case 'anchor':
      assertRegistryHasKey(sheet, 'anchor', parsed.key, '瞄准目标')
      return
    case 'bone':
      assertRegistryHasKey(sheet, 'model', parsed.placementKey, '瞄准目标')
      return
    default:
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `瞄准目标只支持锚点(anchor:)与骨骼锚点(bone:),收到: ${target}`,
        {details: {target, kind: parsed.kind}},
      )
  }
}

/**
 * 领域静态写入:建轨预检 → expectedRevision → 单事务写完(propAccess)。
 * freeze(可选)是解除类写入的坐标定格,折进同一事务(F1 修复):
 * preflight 只管领域属性,定格与 UI 看护的 scrub 写入同语义。
 */
async function writeCameraStaticProp(
  runtime: AgentRuntime,
  sheetObject: ISheetObject<any>,
  props: Record<string, unknown>,
  expectedRevision: number | undefined,
  freeze?: Record<string, unknown>,
): Promise<{revision: number}> {
  assertStaticPropsWritable(sheetObject, props)
  if (expectedRevision !== undefined) runtime.assertRevision(expectedRevision)
  setStaticPropsWithFreeze(sheetObject, props, freeze ?? {})
  // historic 通知 tick 调度:等一个 tick,返回反映本次写入的 revision
  return {revision: await runtime.nextRevision()}
}

/**
 * 解绑路径的机位定格(F1):驱动机位 = 绑定路径当前进度处的采样点——
 * 与 ShotCamera 帧驱动每帧写入 drivenPosRef、看护定格读 drivenPosRef
 * 同源(同一采样器与 progress),命令此刻同步采样得到同一值。
 * 路径未挂载/无控制点(从未驱动)返回 undefined:机位不动,只清 pathKey,
 * 看护的 alreadyFrozen 守卫看到 persisted==当前机位即跳过。
 */
function planUnbindFreeze(sheetObject: ISheetObject<any>): Vec3 | undefined {
  const pathKey = (val(sheetObject.props.pathKey) as string | undefined) ?? ''
  if (!pathKey) return undefined
  const sampler = getPathSampler(pathKey)
  const pathObj = getSceneSheetObject(formatSceneObjectId('path', pathKey))
  if (!sampler || !pathObj) return undefined
  const progress = (val(pathObj.props.progress) as number | undefined) ?? 0
  const out = new Vector3()
  return sampler(progress, out) ? {x: out.x, y: out.y, z: out.z} : undefined
}

/**
 * 解除瞄准的朝向定格(F1):与 ShotCamera 看护同一算法——from 取绑定路径
 * 采样点(机位被路径接管时)否则相机当前机位,lookAt(from, 目标世界位置)
 * 转 XYZ 欧拉角。目标此刻可解析(tracking 为 true)才有定格必要;
 * 目标已失效时看护的 prev===true 闸本就不通过,返回 undefined 只写属性。
 */
function planAimReleaseFreeze(
  sheetObject: ISheetObject<any>,
): Vec3 | undefined {
  const prevTarget = (val(sheetObject.props.aimTarget) as string) ?? ''
  if (!prevTarget) return undefined
  const aimObj = resolveAimTarget(prevTarget)
  if (!aimObj) return undefined
  const {objectKey: cameraKey} = sheetObject.address
  const cam = getShotCameraObjects().get(cameraKey)
  const from = new Vector3()
  if (!sampleBoundPathPosition(sheetObject, from)) {
    if (cam) {
      from.copy(cam.position)
    } else {
      // 未驱动相机的持久 position 即画面机位(包装器全量应用过)
      const persisted = (val(sheetObject.props.position) as
        | Vec3
        | undefined) ?? {
        x: 0,
        y: 0,
        z: 0,
      }
      from.set(persisted.x, persisted.y, persisted.z)
    }
  }
  const targetPos = aimObj.getWorldPosition(new Vector3())
  const m = new Matrix4().lookAt(
    from,
    targetPos,
    cam?.up ?? new Vector3(0, 1, 0),
  )
  const e = new Euler().setFromRotationMatrix(m, 'XYZ')
  return {x: e.x, y: e.y, z: e.z}
}

/** 机位被在册路径接管时采样当前进度处的世界机位;不可采样返回 false */
function sampleBoundPathPosition(
  sheetObject: ISheetObject<any>,
  out: Vector3,
): boolean {
  const pathKey = (val(sheetObject.props.pathKey) as string | undefined) ?? ''
  if (!pathKey) return false
  const sampler = getPathSampler(pathKey)
  const pathObj = getSceneSheetObject(formatSceneObjectId('path', pathKey))
  if (!sampler || !pathObj) return false
  const progress = (val(pathObj.props.progress) as number | undefined) ?? 0
  return sampler(progress, out)
}

/** 挂载等待兑现后的双可见复核(与 models.create 同一不变量) */
function assertCreateVisible(
  runtime: AgentRuntime,
  objectId: SceneObjectId,
): void {
  let mounted: boolean
  try {
    mounted = getSceneObjectSummary(runtime.sheet, objectId).mounted
  } catch (error) {
    throw new AgentApiError(
      'INTERNAL_ERROR',
      `创建已提交但场景对象不可见: ${objectId}`,
      {
        details: {
          objectId,
          cause: error instanceof Error ? error.message : String(error),
        },
      },
    )
  }
  if (!mounted) {
    throw new AgentApiError(
      'INTERNAL_ERROR',
      `创建已提交但 SheetObject 未登记: ${objectId}`,
      {details: {objectId}},
    )
  }
}

export function registerCameraCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<CreateArgs, {objectId: SceneObjectId; revision: number}>({
    name: 'cameras.create',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'mounted',
    inputSchema: createInput,
    outputSchema: createOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
      'INTERNAL_ERROR',
    ],
    validate: validateCreate,
    execute: async (args) => {
      runtime.assertActive()
      // 乐观并发:先于任何副作用(handler 经它写注册表)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      const createCamera = runtime.handlers.createCamera
      if (!createCamera) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Scene Runtime 未绑定 createCamera,无法创建相机',
        )
      }
      const {key} = createCamera(
        args.transform
          ? {
              seed: {
                position: args.transform.position,
                rotation: args.transform.rotation,
              },
            }
          : {},
      )
      // handler 同步写注册表返回 key;React 挂载必然晚于本调用栈,
      // 此处创建 waiter 不会错过通知
      const mounted = createCameraWaiter(key)
      try {
        await mounted
      } catch (error) {
        // dispose 优先于挂载失败:会话已销毁时统一 API_DISPOSED
        runtime.assertActive()
        throw new AgentApiError('INTERNAL_ERROR', `相机挂载失败: ${key}`, {
          details: {
            objectId: formatSceneObjectId('camera', key),
            cause: error instanceof Error ? error.message : String(error),
          },
        })
      }
      runtime.assertActive()
      const objectId = formatSceneObjectId('camera', key)
      assertCreateVisible(runtime, objectId)
      return {objectId, revision: await runtime.nextRevision()}
    },
  })

  registry.register<SetActiveArgs, void>({
    name: 'cameras.setActive',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: {objectId: objectIdProperty},
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: voidOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => ({
      objectId: requireString(requireObject(value), 'objectId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      // 只校验类型与注册表存在性;会话指向不要求已挂载
      // (CameraScene 的活动推导对失效 key 自行顺位回退)
      resolveSceneSheetObject(runtime.sheet, args.objectId, 'camera')
      const setActiveCamera = runtime.handlers.setActiveCamera
      if (!setActiveCamera) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Scene Runtime 未绑定 setActiveCamera,无法设置活动相机',
        )
      }
      const {key} = parseSceneObjectId(args.objectId)
      setActiveCamera({cameraKey: key})
    },
  })

  registry.register<SetAimTargetArgs, {revision: number}>({
    name: 'cameras.setAimTarget',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        target: {
          type: 'string',
          description:
            "瞄准目标:''(解除)| anchor:<key> | bone:<placementKey>#<part>",
        },
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'target'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      const target = args.target
      if (typeof target !== 'string') {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'target 必须是字符串(空串 = 解除瞄准)',
        )
      }
      return {
        objectId: requireString(args, 'objectId'),
        target,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedCamera(runtime, args.objectId)
      // 目标校验先于建轨预检:无效目标不得写 props
      assertAimTargetValid(runtime.sheet, args.target)
      // 解除瞄准(target==='')把当前朝向定格折进同一事务(F1);看护的
      // 同值守卫看到 persisted==定格值即跳过,一步撤销
      const freeze =
        args.target === '' ? planAimReleaseFreeze(sheetObject) : undefined
      return writeCameraStaticProp(
        runtime,
        sheetObject,
        {aimTarget: args.target},
        args.expectedRevision,
        freeze ? {rotation: freeze} : undefined,
      )
    },
  })

  registry.register<BindPathArgs, {revision: number}>({
    name: 'cameras.bindPath',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        pathId: {type: 'string', description: '带类型路径 ID,path:<key>'},
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'pathId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        objectId: requireString(args, 'objectId'),
        pathId: requireString(args, 'pathId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedCamera(runtime, args.objectId)
      // pathId 类型与存在性先于建轨预检;不写 props
      const {kind, key} = parseSceneObjectId(args.pathId)
      if (kind !== 'path') {
        throw new AgentApiError(
          'INVALID_ID_KIND',
          `对象 ${args.pathId} 的类型是 ${kind},此处需要 path`,
          {details: {objectId: args.pathId, kind, expectedKind: 'path'}},
        )
      }
      assertRegistryHasKey(runtime.sheet, 'path', key, '被绑定路径')
      return writeCameraStaticProp(
        runtime,
        sheetObject,
        {pathKey: key},
        args.expectedRevision,
      )
    },
  })

  registry.register<UnbindPathArgs, {revision: number}>({
    name: 'cameras.unbindPath',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        objectId: requireString(args, 'objectId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedCamera(runtime, args.objectId)
      // 清空绑定 + 驱动机位定格同一事务(F1);看护的 alreadyFrozen 守卫
      // 看到 persisted==定格值即跳过,一步撤销
      const freeze = planUnbindFreeze(sheetObject)
      return writeCameraStaticProp(
        runtime,
        sheetObject,
        {pathKey: ''},
        args.expectedRevision,
        freeze ? {position: freeze} : undefined,
      )
    },
  })
}
