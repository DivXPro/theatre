/**
 * poses 命令(2026-10-17,Task 9):apply / applyCustom / clear / saveCurrent /
 * setGesture + poses.session.start / commit / cancel。
 *
 * 静态语义(preflight ruling):apply / applyCustom / setGesture 只写未建轨
 * 的静态值——props 经 setStaticProps(propAccess 的形状 + 建轨校验),已建轨
 * 返回 INVALID_STATE,绝不顺手写关键帧;打帧由 keyframes.* 显式进行。
 * poses.clear 是显式移除姿势轨的例外:单事务 stateEditors
 * (unsequenceProp + unset 语义)仍保持一个撤销步骤,由
 * poseTrack.clearPoseValue 实现,UI 清除按钮共用。
 *
 * saveCurrent 属资产域(undoable:none,spec 8.6.4):实例经 Scene Runtime
 * 的 getModelPlacement handler 取得(不直接摸 React 闭包),入库流程与
 * CameraScene 共用 poseMode/savePose.savePoseFromInstance。
 *
 * 会话命令(会话域,不用项目 revision 伪装并发):start 进会话并等
 * PoseModeRig 经 poseSessionRuntime 登记 Rig 句柄(completion:mounted,
 * 防御性清会话 = Rig 未挂载,拒绝 INVALID_STATE 不悬挂);commit/cancel
 * 调用 Rig 登记的句柄,与 UI 的 Esc/双击空白同一提交路径。
 *
 * 校验顺序同 objects.update:对象(类型/存在/挂载)→ 参数 → 资产/兼容性 →
 * 建轨预检 → expectedRevision → 事务。
 */
import type {Group} from 'three'
import {AgentApiError} from '../errors'
import {resolveSceneSheetObject} from '../objectResolver'
import {formatSceneObjectId, parseSceneObjectId} from '../objectIds'
import {assertStaticPropsWritable, setStaticProps} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema, SceneObjectId} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'
import {
  getPoseSessionRig,
  whenPoseSessionRig,
} from '../runtime/poseSessionRuntime'
import {
  enterPoseSession,
  getPoseSession,
  getPoseSessionFrame,
} from '../../poseMode/poseSession'
import {clearPoseValue} from '../../poseMode/poseTrack'
import {serializeCustomPose, serializeLibPose} from '../../poseMode/poseValue'
import type {PoseBones} from '../../poseMode/poseOverride'
import {savePoseFromInstance} from '../../poseMode/savePose'
import type {PoseFrameMode} from '../../poseMode/poseFrame'
import {gestureEntryNameSide, isHandPoseEntry} from '../../gestureProps'
import type {GestureSide} from '../../gestureProps'
import type {PlacementEntry} from '../../PlacementManager'
import type {PoseEntry} from '../../assetLibrary/types'
import {mapLibraryError} from './assets'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 取已放置模型的运行时实例与放置条目(未挂载返回 undefined)。
     * 生产由 CameraScene/PlacementManager 绑定(转发
     * getPlacementInstanceForObject);poses.saveCurrent /
     * poses.session.start / animations.apply 共用。
     */
    getModelPlacement(args: {
      key: string
    }): {entry: PlacementEntry; instance: Group} | undefined
  }
}

/** 姿势门面(Task 15 由同名命令转发实现) */
export type PosesApi = {
  apply(args: {
    objectId: string
    assetId: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  applyCustom(args: {
    objectId: string
    bones: PoseBones
    expectedRevision?: number
  }): Promise<{revision: number}>
  clear(args: {
    objectId: string
    expectedRevision?: number
  }): Promise<{cleared: boolean; revision: number}>
  saveCurrent(args: {objectId: string; name?: string}): Promise<PoseEntry>
  setGesture(args: {
    objectId: string
    side: GestureSide
    assetId: string | null
    expectedRevision?: number
  }): Promise<{revision: number}>
}

/** 姿势会话门面(IK 摆姿势;需要已挂载 Rig) */
export type PosesSessionApi = {
  start(args: {
    objectId: string
  }): Promise<{objectId: SceneObjectId; frame?: PoseFrameMode}>
  commit(): Promise<{objectId: SceneObjectId}>
  cancel(): Promise<{objectId: SceneObjectId}>
}

type ApplyArgs = {
  objectId: string
  assetId: string
  expectedRevision?: number
}
type ApplyCustomArgs = {
  objectId: string
  bones: PoseBones
  expectedRevision?: number
}
type ClearArgs = {objectId: string; expectedRevision?: number}
type SaveCurrentArgs = {objectId: string; name?: string}
type SetGestureArgs = {
  objectId: string
  side: GestureSide
  assetId: string | null
  expectedRevision?: number
}

const objectIdProperty: JsonSchema = {
  type: 'string',
  description: '带类型场景对象 ID(模型),如 model:Y Bot',
}

const expectedRevisionProperty: JsonSchema = {
  type: 'number',
  description: '乐观并发:读取场景时的 revision',
}

const bonesSchema: JsonSchema = {
  type: 'object',
  description:
    '骨骼快照:骨骼名 → {rotation?: [x,y,z,w] 四元数, position?: [x,y,z]}',
  additionalProperties: {
    type: 'object',
    properties: {
      rotation: {type: 'array', items: {type: 'number'}},
      position: {type: 'array', items: {type: 'number'}},
    },
    additionalProperties: false,
  },
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

const poseEntryOutput: JsonSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    kind: {enum: ['pose']},
    name: {type: 'string'},
    rig: {type: 'string'},
    bones: bonesSchema,
    createdAt: {type: 'number'},
  },
  required: ['id', 'kind', 'name', 'rig', 'bones', 'createdAt'],
}

function optionalExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return requireFiniteNumber(value, 'expectedRevision')
}

/** 骨骼快照参数校验:非空表;每根骨至多 rotation[4]/position[3] 且有限 */
function requireBones(value: unknown): PoseBones {
  const record = requireObject(value)
  const names = Object.keys(record)
  if (names.length === 0) {
    throw new AgentApiError('INVALID_ARGUMENT', 'bones 不能为空对象')
  }
  for (const name of names) {
    const entry = requireObject(record[name])
    const keys = Object.keys(entry)
    if (keys.some((k) => k !== 'rotation' && k !== 'position')) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `bones.${name} 只接受 rotation / position 字段`,
      )
    }
    if (!('rotation' in entry) && !('position' in entry)) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `bones.${name} 至少需要 rotation 或 position 之一`,
      )
    }
    if ('rotation' in entry)
      requireNumberTuple(entry.rotation, `bones.${name}.rotation`, 4)
    if ('position' in entry)
      requireNumberTuple(entry.position, `bones.${name}.position`, 3)
  }
  return record as PoseBones
}

function requireNumberTuple(
  value: unknown,
  label: string,
  length: number,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `${label} 必须是长度为 ${length} 的有限数字数组`,
    )
  }
}

function requireSide(value: unknown): GestureSide {
  if (value !== 'left' && value !== 'right') {
    throw new AgentApiError('INVALID_ARGUMENT', 'side 必须是 left 或 right')
  }
  return value
}

/** 解析模型对象:类型不符 INVALID_ID_KIND、不存在 OBJECT_NOT_FOUND、未挂载 INVALID_STATE */
function resolveMountedModel(runtime: AgentRuntime, objectId: string) {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId, 'model')
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `对象未挂载,无法操作: ${objectId}`,
      {details: {objectId}},
    )
  }
  return sheetObject
}

/** 经 Scene Runtime 取模型的挂载实例与放置条目(handler 未绑定 SCENE_UNAVAILABLE) */
function requireModelPlacement(
  runtime: AgentRuntime,
  objectId: string,
): {entry: PlacementEntry; instance: Group} {
  const getModelPlacement = runtime.handlers.getModelPlacement
  if (!getModelPlacement) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Scene Runtime 未绑定 getModelPlacement,无法访问模型实例',
    )
  }
  const {key} = parseSceneObjectId(objectId)
  const placement = getModelPlacement({key})
  if (!placement) {
    throw new AgentApiError('INVALID_STATE', `模型实例未挂载: ${objectId}`, {
      details: {objectId},
    })
  }
  return placement
}

/** 取库姿势条目:不存在 ASSET_NOT_FOUND;非姿势 INVALID_ARGUMENT */
async function requirePoseEntry(
  runtime: AgentRuntime,
  assetId: string,
): Promise<PoseEntry> {
  const entry = await runtime.library.getEntry(assetId)
  if (!entry) {
    throw new AgentApiError('ASSET_NOT_FOUND', `资产不存在: ${assetId}`, {
      details: {assetId},
    })
  }
  if (entry.kind !== 'pose') {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `资产 ${assetId} 不是姿势(kind: ${entry.kind})`,
      {details: {assetId, kind: entry.kind}},
    )
  }
  return entry
}

/** 领域静态写入:建轨预检 → expectedRevision → 单事务写完(propAccess) */
function writeStaticProp(
  runtime: AgentRuntime,
  sheetObject: Parameters<typeof setStaticProps>[0],
  props: Record<string, unknown>,
  expectedRevision: number | undefined,
): {revision: number} {
  assertStaticPropsWritable(sheetObject, props)
  if (expectedRevision !== undefined) runtime.assertRevision(expectedRevision)
  setStaticProps(sheetObject, props)
  // historic 通知可能尚未在同一调用栈触发;返回当前值,不手工加一
  return {revision: runtime.revision}
}

export function registerPoseCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<ApplyArgs, {revision: number}>({
    name: 'poses.apply',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        assetId: {type: 'string', description: '库姿势条目 id'},
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'assetId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'ASSET_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        objectId: requireString(args, 'objectId'),
        assetId: requireString(args, 'assetId'),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      await requirePoseEntry(runtime, args.assetId)
      return writeStaticProp(
        runtime,
        sheetObject,
        {pose: serializeLibPose(args.assetId)},
        args.expectedRevision,
      )
    },
  })

  registry.register<ApplyCustomArgs, {revision: number}>({
    name: 'poses.applyCustom',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        bones: bonesSchema,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'bones'],
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
        bones: requireBones(args.bones),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      return writeStaticProp(
        runtime,
        sheetObject,
        {pose: serializeCustomPose(args.bones)},
        args.expectedRevision,
      )
    },
  })

  registry.register<ClearArgs, {cleared: boolean; revision: number}>({
    name: 'poses.clear',
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
    outputSchema: {
      type: 'object',
      properties: {
        cleared: {
          type: 'boolean',
          description: '是否确有轨道或静态值被清除(空姿势为 false)',
        },
        revision: {type: 'number'},
      },
      required: ['cleared', 'revision'],
    },
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
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      // 乐观并发先于任何副作用
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      // 显式移除姿势轨的例外:单事务 unsequenceProp + unset 语义
      // (stateEditors 直写,一个撤销步骤);空姿势不开事务
      const outcome = clearPoseValue(sheetObject)
      if (outcome === 'unavailable') {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Studio 不可用,无法清除姿势',
        )
      }
      return {cleared: outcome === 'cleared', revision: runtime.revision}
    },
  })

  registry.register<SaveCurrentArgs, PoseEntry>({
    name: 'poses.saveCurrent',
    kind: 'mutation',
    stateDomain: 'asset',
    undoable: 'none',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        name: {
          type: 'string',
          description: '姿势名称;缺省为 姿势-N(库姿势数 + 1)',
        },
      },
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: poseEntryOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'SCENE_UNAVAILABLE',
      'STORAGE_ERROR',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
    ],
    validate: (value) => {
      const args = requireObject(value)
      let name: string | undefined
      if (args.name !== undefined) {
        name = requireString(args, 'name').trim()
        if (!name) {
          throw new AgentApiError('INVALID_ARGUMENT', 'name 不能是空白字符串')
        }
      }
      return {objectId: requireString(args, 'objectId'), name}
    },
    execute: async (args) => {
      runtime.assertActive()
      resolveMountedModel(runtime, args.objectId)
      const placement = requireModelPlacement(runtime, args.objectId)
      const library = runtime.library
      const name =
        args.name ?? `姿势-${(await library.listEntries('pose')).length + 1}`
      try {
        const entry = await savePoseFromInstance({
          library,
          instance: placement.instance,
          libraryEntryId: placement.entry.libraryEntryId,
          name,
        })
        if (!entry) {
          throw new AgentApiError(
            'INVALID_STATE',
            `静态骨架模型不能保存姿势: ${args.objectId}`,
            {details: {objectId: args.objectId}},
          )
        }
        return entry
      } catch (error) {
        if (error instanceof AgentApiError) throw error
        throw mapLibraryError(error)
      }
    },
  })

  registry.register<SetGestureArgs, {revision: number}>({
    name: 'poses.setGesture',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        side: {enum: ['left', 'right'], description: '手势侧别'},
        assetId: {
          type: 'string',
          description: '库手势条目 id;null 清除本侧手势',
        },
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'side', 'assetId'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'ASSET_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => {
      const args = requireObject(value)
      const assetId = args.assetId
      if (assetId !== null && typeof assetId !== 'string') {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'assetId 必须是字符串或 null',
        )
      }
      if (typeof assetId === 'string' && !assetId) {
        throw new AgentApiError('INVALID_ARGUMENT', 'assetId 不能为空字符串')
      }
      return {
        objectId: requireString(args, 'objectId'),
        side: requireSide(args.side),
        assetId: assetId as string | null,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedModel(runtime, args.objectId)
      const prop = args.side === 'left' ? 'gestureL' : 'gestureR'
      let value = ''
      if (args.assetId !== null) {
        const entry = await requirePoseEntry(runtime, args.assetId)
        // 手势属性只收手势条目(纯手指骨),全身姿势拒绝
        if (!isHandPoseEntry(entry)) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            `条目 ${args.assetId} 不是手势(含非手指骨)`,
            {details: {assetId: args.assetId}},
          )
        }
        // 侧别校验:带「· 左手/· 右手」后缀的条目必须落在本侧;
        // 无后缀 = 双手手势,两侧可用(与 buildGestureOptions 同规则)
        const nameSide = gestureEntryNameSide(entry.name)
        if (nameSide !== null && nameSide !== args.side) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            `手势条目侧别不符: ${entry.name} 不能用于 ${args.side} 侧`,
            {details: {assetId: args.assetId, side: args.side, nameSide}},
          )
        }
        value = serializeLibPose(args.assetId)
      }
      return writeStaticProp(
        runtime,
        sheetObject,
        {[prop]: value},
        args.expectedRevision,
      )
    },
  })

  // —— 姿势会话(IK 摆姿势;会话域,不用项目 revision)——

  const sessionObjectOutput: JsonSchema = {
    type: 'object',
    properties: {
      objectId: {type: 'string', description: '会话所在模型的带类型 ID'},
      frame: {
        type: 'object',
        description: '会话帧信息(帧上=编辑该帧 / 帧间=新建帧);仅 start 返回',
      },
    },
    required: ['objectId'],
  }

  registry.register<
    {objectId: string},
    {objectId: SceneObjectId; frame?: PoseFrameMode}
  >({
    name: 'poses.session.start',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    completion: 'mounted',
    inputSchema: {
      type: 'object',
      properties: {objectId: objectIdProperty},
      required: ['objectId'],
      additionalProperties: false,
    },
    outputSchema: sessionObjectOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'SCENE_UNAVAILABLE',
    ],
    validate: (value) => ({
      objectId: requireString(requireObject(value), 'objectId'),
    }),
    execute: async (args) => {
      runtime.assertActive()
      resolveMountedModel(runtime, args.objectId)
      // 模型实例必须已挂载,Rig 才挂得上
      requireModelPlacement(runtime, args.objectId)
      const {key} = parseSceneObjectId(args.objectId)
      // 与 UI 同一入口:已在摆别的模型时先按退出流程提交旧会话
      enterPoseSession(key)
      // completion:mounted——等 PoseModeRig 登记 Rig 句柄;防御性清会话
      // (无根骨/无装配表)时 waiter 以 INVALID_STATE 拒绝,不悬挂
      await whenPoseSessionRig(key)
      runtime.assertActive()
      // Rig 登记在帧信息写入之后,此处 frame 可用;测试手工登记时缺省
      const frame = getPoseSessionFrame() ?? undefined
      return {objectId: formatSceneObjectId('model', key), frame}
    },
  })

  const registerSessionEndCommand = (
    name: 'poses.session.commit' | 'poses.session.cancel',
    pick: 'commit' | 'cancel',
  ) => {
    registry.register<Record<string, unknown>, {objectId: SceneObjectId}>({
      name,
      kind: 'mutation',
      stateDomain: 'session',
      // commit 在脏会话里写姿势帧(writePoseKeyframe 单个 scrub commit);
      // cancel 不写项目状态
      undoable: pick === 'commit' ? 'single-step' : 'none',
      ...(pick === 'commit' ? {completion: 'committed' as const} : {}),
      inputSchema: {type: 'object', additionalProperties: false},
      outputSchema: sessionObjectOutput,
      errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT', 'INVALID_STATE'],
      validate: (value) =>
        value === undefined || value === null ? {} : requireObject(value),
      execute: async () => {
        runtime.assertActive()
        const session = getPoseSession()
        if (!session) {
          throw new AgentApiError('INVALID_STATE', '当前没有姿势会话')
        }
        const rig = getPoseSessionRig(session.key)
        if (!rig) {
          throw new AgentApiError(
            'INVALID_STATE',
            `姿势会话的 Rig 未挂载: ${session.key}`,
            {details: {key: session.key}},
          )
        }
        // 先快照 key:句柄内部会清会话
        const objectId = formatSceneObjectId('model', session.key)
        rig[pick]()
        return {objectId}
      },
    })
  }
  registerSessionEndCommand('poses.session.commit', 'commit')
  registerSessionEndCommand('poses.session.cancel', 'cancel')
}
