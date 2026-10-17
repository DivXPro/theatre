/**
 * objects.update(2026-10-17,Task 5):通用静态属性更新与 revision 冲突保护。
 *
 * 执行顺序(spec 9.1 + Task 5 约束):参数校验 → 对象存在/挂载 → 领域专用
 * 属性拒绝 → 值形状与建轨校验(propAccess,全部在事务之前) →
 * expectedRevision 乐观并发 → 单个 studio.transaction 写完整个 patch。
 * 返回当前 historic 驱动的 revision,不手工加一。
 */
import {AgentApiError} from '../errors'
import {resolveSceneSheetObject} from '../objectResolver'
import {
  assertStaticPropsWritable,
  domainOwnedProps,
  setStaticProps,
} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
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
      // historic 通知可能尚未在同一调用栈触发;返回当前值,不手工加一
      return {revision: runtime.revision}
    },
  })
}
