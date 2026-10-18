/**
 * objects 命令(2026-10-17,Task 5;2026-10-19,Task 14 补 delete):
 * 通用静态属性更新与 revision 冲突保护 + 统一对象删除。
 *
 * update 执行顺序(spec 9.1 + Task 5 约束):参数校验 → 对象存在/挂载 →
 * 领域专用属性拒绝 → 值形状与建轨校验(propAccess,全部在事务之前) →
 * expectedRevision 乐观并发 → 单个 studio.transaction 写完整个 patch。
 * 返回当前 historic 驱动的 revision,不手工加一。
 *
 * delete 执行顺序(spec 9.2):参数校验 → 带类型 ID 解析与注册表存在性
 * (只探测不创建)→ Studio 可用性 → expectedRevision(先于任何副作用)
 * → 按类型的领域删除(deleteSceneObject,forgetObject/注册表/绑定回退
 * 合并为单个事务 = 一步撤销)→ 会话清理(选择里摘除被删对象 +
 * afterSceneObjectDeleted handler)。领域校验失败时不调用会话清理、
 * 不返回 deleted。
 */
import {AgentApiError} from '../errors'
import {deleteSceneObject} from '../deleteHandlers'
import {resolveSceneSheetObject} from '../objectResolver'
import {
  assertStaticPropsWritable,
  domainOwnedProps,
  setStaticProps,
} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {getSceneSheetObject} from '../runtime/objectRuntime'
import type {JsonSchema, SceneObjectId} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'

type UpdateArgs = {
  objectId: string
  props: Record<string, unknown>
  expectedRevision?: number
}

const updateInput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {type: 'string', description: '带类型场景对象 ID,如 model:Y Bot'},
    props: {
      type: 'object',
      description: '顶层静态属性 patch;compound 属性必须提供完整值',
    },
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  required: ['objectId', 'props'],
  additionalProperties: false,
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

type DeleteArgs = {objectId: string; expectedRevision?: number}

const deleteInput: JsonSchema = {
  type: 'object',
  properties: {
    objectId: {
      type: 'string',
      description:
        '带类型场景对象 ID(model:/camera:/anchor:/path:<key>);类型决定完整清理行为(spec 9.2)',
    },
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  required: ['objectId'],
  additionalProperties: false,
}

function validateDelete(value: unknown): DeleteArgs {
  const args = requireObject(value)
  return {
    objectId: requireString(args, 'objectId'),
    expectedRevision:
      args.expectedRevision === undefined
        ? undefined
        : requireFiniteNumber(args.expectedRevision, 'expectedRevision'),
  }
}

function validateUpdate(value: unknown): UpdateArgs {
  const args = requireObject(value)
  const objectId = requireString(args, 'objectId')
  const rawProps = args.props
  if (
    !rawProps ||
    typeof rawProps !== 'object' ||
    Array.isArray(rawProps) ||
    Object.keys(rawProps).length === 0
  ) {
    throw new AgentApiError('INVALID_ARGUMENT', 'props 必须是非空对象')
  }
  let expectedRevision: number | undefined
  if (args.expectedRevision !== undefined) {
    expectedRevision = requireFiniteNumber(
      args.expectedRevision,
      'expectedRevision',
    )
  }
  return {
    objectId,
    props: rawProps as Record<string, unknown>,
    expectedRevision,
  }
}

export function registerObjectCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<UpdateArgs, {revision: number}>({
    name: 'objects.update',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: updateInput,
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
    validate: validateUpdate,
    execute: async (args) => {
      runtime.assertActive()
      const sheetObject = resolveSceneSheetObject(runtime.sheet, args.objectId)
      if (!sheetObject) {
        throw new AgentApiError(
          'INVALID_STATE',
          `对象未挂载,无法更新: ${args.objectId}`,
          {details: {objectId: args.objectId}},
        )
      }
      // 专用属性由领域命令自校验后经 setStaticProps 写;通用入口拒绝
      for (const key of Object.keys(args.props)) {
        if (domainOwnedProps.has(key)) {
          throw new AgentApiError(
            'INVALID_ARGUMENT',
            `属性 ${key} 由领域命令管理,objects.update 不可写`,
            {details: {prop: key}},
          )
        }
      }
      // 全部值与建轨状态校验先于事务;setStaticProps 内部会再校验一次
      // (领域命令直接调用它时同样需要这道 guard)
      assertStaticPropsWritable(sheetObject, args.props)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setStaticProps(sheetObject, args.props)
      // historic 通知 tick 调度:等一个 tick,返回反映本次写入的 revision
      return {revision: await runtime.nextRevision()}
    },
  })

  registry.register<DeleteArgs, {deleted: SceneObjectId; revision: number}>({
    name: 'objects.delete',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: deleteInput,
    outputSchema: {
      type: 'object',
      properties: {
        deleted: {type: 'string', description: '已删除的带类型场景对象 ID'},
        revision: {type: 'number'},
      },
      required: ['deleted', 'revision'],
    },
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateDelete,
    execute: async (args) => {
      runtime.assertActive()
      // 领域删除:类型/存在性/Studio 可用性校验 → expectedRevision
      // (先于任何副作用)→ 单个项目事务(一步撤销)。校验失败抛出,
      // 不调用会话清理、不返回 deleted
      const deleted = deleteSceneObject(runtime, args.objectId, () => {
        if (args.expectedRevision !== undefined) {
          runtime.assertRevision(args.expectedRevision)
        }
      })
      // 会话清理(项目事务已提交,同步执行不跨 await):
      // 1) 把被删对象摘出 studio 选择——注册表行已删但组件尚未卸载的
      //    窗口里,selection.get 不得返回已失效 ID(Task 4 遗留窗口在
      //    此关闭:注册表移除与选择清理在同一调用栈完成,命令间无交叉);
      // 2) CameraScene 侧会话态(路径编辑/点选择/大纲伪集合)经
      //    afterSceneObjectDeleted handler 清理(未绑定静默跳过)
      const studio = runtime.getStudio()
      const mounted = getSceneSheetObject(deleted.id)
      if (studio && mounted) {
        const selection = studio.selection as unknown[]
        if (selection.includes(mounted)) {
          studio.setSelection(
            selection.filter((item) => item !== mounted) as never,
          )
        }
      }
      runtime.handlers.afterSceneObjectDeleted?.(deleted)
      return {deleted: deleted.id, revision: await runtime.nextRevision()}
    },
  })
}
