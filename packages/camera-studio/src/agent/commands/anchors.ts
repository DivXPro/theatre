/**
 * anchors 命令(2026-10-17,Task 10):create / setParent / clearParent。
 *
 * create 执行顺序:assertActive → expectedRevision 乐观并发(先于任何
 * 副作用)→ Scene Runtime createAnchor handler(未绑定
 * SCENE_UNAVAILABLE;生产由 CameraScene 绑定,缺省位置由它按导演前方
 * 5 单位计算,captureAnchorSeed)→ 创建挂载 waiter 并等 AnchorObject
 * 的种子 layout effect 通知(completion:mounted;期间 dispose 优先
 * 映射 API_DISPOSED,其余拒绝 INTERNAL_ERROR)→ resolver 复核注册表
 * 与 SheetObject 双双可见(脱节 = INTERNAL_ERROR,不静默成功)。
 *
 * setParent / clearParent 是领域静态写入:parent 属 domainOwnedProps,
 * 命令完成自身校验(目标类型/存在性/自身与成环)与建轨预检后,把
 * parent 与世界/局部坐标定格折进同一事务写入(F1 修复,见
 * writeAnchorParent;AnchorObject 看护 effect 的同值守卫随之跳过,
 * 一步撤销);父级目标运行时对象未就绪(异步加载)抛 INVALID_STATE
 * 可重试。刷新/撤销恢复既有绑定的挂载仍由既有 useFrame 重试循环兜底。
 *
 * 父级目标与 UI 下拉同集:anchor:<key>(排除自身与后代,成环
 * INVALID_ARGUMENT)/ model:<key> / camera:<key> /
 * bone:<placement>#<part>;空串归 clearParent。
 */
import {val} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {formatSceneObjectId} from '../objectIds'
import {
  getSceneObjectSummary,
  listSceneObjectKeys,
  resolveSceneSheetObject,
} from '../objectResolver'
import {
  assertStaticPropsWritable,
  setStaticPropsWithFreeze,
} from '../propAccess'
import {createAnchorWaiter} from '../runtime/cameraLifecycle'
import type {JsonSchema, SceneObjectId, Vec3} from '../types'
import {
  requireFiniteNumber,
  requireObject,
  requireString,
  requireVec3,
} from '../validation'
import {
  isDescendantAnchor,
  parseTargetId,
  planAnchorParentFreeze,
} from '../../aimTargets'

declare module '../runtime' {
  interface AgentSceneRuntimeHandlers {
    /**
     * 创建锚点(CameraScene 绑定,转发 addAnchorToRegistry):同步生成
     * key、写注册表清单、stash 位置种子,立即返回;position 缺省时由
     * CameraScene 按当前导演视角前方 5 单位计算(captureAnchorSeed)。
     * 挂载完成经 cameraLifecycle.notifyAnchorReady 通知。
     */
    createAnchor(args: {position?: Vec3}): {key: string}
  }
}

/** 锚点门面(Task 15 由同名命令转发实现) */
export type AnchorsApi = {
  create(args: {
    position?: Vec3
    expectedRevision?: number
  }): Promise<{objectId: SceneObjectId; revision: number}>
  setParent(args: {
    objectId: SceneObjectId
    parent: string
    expectedRevision?: number
  }): Promise<{revision: number}>
  clearParent(args: {
    objectId: SceneObjectId
    expectedRevision?: number
  }): Promise<{revision: number}>
}

type CreateArgs = {position?: Vec3; expectedRevision?: number}
type SetParentArgs = {
  objectId: string
  parent: string
  expectedRevision?: number
}
type ClearParentArgs = {objectId: string; expectedRevision?: number}

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
  description: '带类型场景对象 ID,anchor:<key>',
}

const createOutput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {type: 'string', description: '带类型场景对象 ID,anchor:<key>'},
    revision: {type: 'number'},
  },
  required: ['objectId', 'revision'],
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

function optionalExpectedRevision(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, 'expectedRevision')
}

/** 解析锚点对象:类型不符 INVALID_ID_KIND、不存在 OBJECT_NOT_FOUND、未挂载 INVALID_STATE */
function resolveMountedAnchor(runtime: AgentRuntime, objectId: string) {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId, 'anchor')
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `锚点已登记但尚未挂载,无法操作: ${objectId}`,
      {details: {objectId}},
    )
  }
  return sheetObject
}

/** 注册表存在性底账(只探测不创建);缺失 OBJECT_NOT_FOUND */
function assertRegistryHasKey(
  sheet: ISheet,
  kind: 'model' | 'camera' | 'anchor',
  key: string,
): void {
  if (!listSceneObjectKeys(sheet, kind).includes(key)) {
    throw new AgentApiError(
      'OBJECT_NOT_FOUND',
      `父级目标不存在: ${kind}:${key}`,
      {details: {objectId: formatSceneObjectId(kind, key), kind}},
    )
  }
}

/**
 * 父级目标校验:类型/存在性/自身与成环。只校验不写 props。
 * 成环检测与 UI 下拉(anchorParentOptionsFor)同一判定:
 * isDescendantAnchor + 沿父链读持久 parent 值。
 */
function assertParentValid(
  sheet: ISheet,
  selfKey: string,
  parent: string,
): void {
  const parsed = parseTargetId(parent)
  if (!parsed) {
    throw new AgentApiError('INVALID_ID_KIND', `无效父级目标 ID: ${parent}`, {
      details: {parent},
    })
  }
  switch (parsed.kind) {
    case 'anchor': {
      if (parsed.key === selfKey) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `锚点不能以自己为父级: ${parent}`,
          {details: {parent}},
        )
      }
      assertRegistryHasKey(sheet, 'anchor', parsed.key)
      // 沿父链读持久 parent(只探测不创建:sheet.object 会顺手建对象;
      // getObject 返回内部对象,props 在 publicApi 上,须剥一层)
      const parentOf = (key: string): string => {
        try {
          const internal = (privateAPI(sheet) as any).getObject(key)
          const obj = (internal?.publicApi ?? undefined) as
            | ISheetObject<any>
            | undefined
          return obj ? (val(obj.props.parent) as string | undefined) ?? '' : ''
        } catch {
          return ''
        }
      }
      if (isDescendantAnchor(selfKey, parsed.key, parentOf)) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          `父级绑定成环: ${selfKey} → ${parsed.key}`,
          {details: {parent}},
        )
      }
      return
    }
    case 'model':
      assertRegistryHasKey(sheet, 'model', parsed.key)
      return
    case 'camera':
      assertRegistryHasKey(sheet, 'camera', parsed.key)
      return
    case 'bone':
      assertRegistryHasKey(sheet, 'model', parsed.placementKey)
      return
  }
}

/**
 * 父级切换写入(2026-10-19,F1 修复):parent 与坐标定格折进同一事务。
 *
 * 原实现只写 parent,世界/局部换算由 AnchorObject 的看护 effect 在属性
 * 变化后补一笔提交——属性一笔、定格一笔,两步撤销,undo 一次只回属性
 * 不回定格,锚点跳变(撤销陷阱,同 removeAnchor 注释)。现在:同步算
 * 定格(planAnchorParentFreeze,命令要求锚点已挂载,世界矩阵可解析),
 * 事务内同写 parent+position,提交后立即换父(抢在包装器应用新
 * position 与看护 effect 之前);看护的同值守卫看到 persisted==定格值
 * 即跳过提交,全程一步撤销。
 *
 * 锚点网格未登记 / 父级目标运行时对象未就绪(异步加载)→ INVALID_STATE
 * (可重试),不写半悬挂状态。
 */
function writeAnchorParent(
  runtime: AgentRuntime,
  sheetObject: ISheetObject<any>,
  parent: string,
  expectedRevision: number | undefined,
): {revision: number} {
  assertStaticPropsWritable(sheetObject, {parent})
  if (expectedRevision !== undefined) runtime.assertRevision(expectedRevision)
  const {objectKey: selfKey} = sheetObject.address
  const freeze = planAnchorParentFreeze(selfKey, parent)
  if (!freeze) {
    throw new AgentApiError(
      'INVALID_STATE',
      parent === ''
        ? `锚点网格尚未挂载,无法定格世界坐标: anchor:${selfKey}`
        : `父级目标已登记但运行时对象未就绪(异步加载中),请重试: ${parent}`,
      {details: {objectId: formatSceneObjectId('anchor', selfKey), parent}},
    )
  }
  setStaticPropsWithFreeze(sheetObject, {parent}, {position: freeze.position})
  // 事务已提交,立即换父:包装器下一 tick 应用 position=定格值时节点已在
  // 正确父级下,世界坐标不跳;看护 effect 的同值守卫随之跳过提交
  freeze.reparent()
  // historic 通知可能尚未在同一调用栈触发;返回当前值,不手工加一
  return {revision: runtime.revision}
}

export function registerAnchorCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<CreateArgs, {objectId: SceneObjectId; revision: number}>({
    name: 'anchors.create',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'mounted',
    inputSchema: {
      type: 'object',
      properties: {
        position: {
          ...vec3Schema,
          description: '创建位置(世界坐标);缺省 = 导演视角前方 5 单位',
        },
        expectedRevision: expectedRevisionProperty,
      },
      additionalProperties: false,
    },
    outputSchema: createOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
      'INTERNAL_ERROR',
    ],
    validate: (value) => {
      const args = requireObject(value)
      return {
        position:
          args.position === undefined ? undefined : requireVec3(args.position),
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      // 乐观并发:先于任何副作用(handler 经它写注册表)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      const createAnchor = runtime.handlers.createAnchor
      if (!createAnchor) {
        throw new AgentApiError(
          'SCENE_UNAVAILABLE',
          'Scene Runtime 未绑定 createAnchor,无法创建锚点',
        )
      }
      const {key} = createAnchor(args.position ? {position: args.position} : {})
      // handler 同步写注册表返回 key;React 挂载必然晚于本调用栈,
      // 此处创建 waiter 不会错过通知
      const mounted = createAnchorWaiter(key)
      try {
        await mounted
      } catch (error) {
        // dispose 优先于挂载失败:会话已销毁时统一 API_DISPOSED
        runtime.assertActive()
        throw new AgentApiError('INTERNAL_ERROR', `锚点挂载失败: ${key}`, {
          details: {
            objectId: formatSceneObjectId('anchor', key),
            cause: error instanceof Error ? error.message : String(error),
          },
        })
      }
      runtime.assertActive()
      const objectId = formatSceneObjectId('anchor', key)
      // 双可见复核(与 models.create 同一不变量)
      let summary: ReturnType<typeof getSceneObjectSummary>
      try {
        summary = getSceneObjectSummary(runtime.sheet, objectId)
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
      if (!summary.mounted) {
        throw new AgentApiError(
          'INTERNAL_ERROR',
          `创建已提交但 SheetObject 未登记: ${objectId}`,
          {details: {objectId}},
        )
      }
      return {objectId, revision: runtime.revision}
    },
  })

  registry.register<SetParentArgs, {revision: number}>({
    name: 'anchors.setParent',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: objectIdProperty,
        parent: {
          type: 'string',
          description:
            '父级目标:anchor:<key> | model:<key> | camera:<key> | bone:<placementKey>#<part>',
        },
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'parent'],
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
      const parent = args.parent
      if (typeof parent !== 'string' || !parent) {
        throw new AgentApiError(
          'INVALID_ARGUMENT',
          'parent 必须是非空字符串(解除父级用 anchors.clearParent)',
        )
      }
      return {
        objectId: requireString(args, 'objectId'),
        parent,
        expectedRevision: optionalExpectedRevision(args.expectedRevision),
      }
    },
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveMountedAnchor(runtime, args.objectId)
      // 目标校验先于建轨预检:无效目标不得写 props
      const {objectKey: selfKey} = sheetObject.address
      assertParentValid(runtime.sheet, selfKey, args.parent)
      return writeAnchorParent(
        runtime,
        sheetObject,
        args.parent,
        args.expectedRevision,
      )
    },
  })

  registry.register<ClearParentArgs, {revision: number}>({
    name: 'anchors.clearParent',
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
      const sheetObject = resolveMountedAnchor(runtime, args.objectId)
      // 清空父级 + 世界坐标定格同一事务(F1);定格后看护 effect 同值守卫
      // 跳过,挂回 home 由 writeAnchorParent 的 reparent 同步完成
      return writeAnchorParent(runtime, sheetObject, '', args.expectedRevision)
    },
  })
}
