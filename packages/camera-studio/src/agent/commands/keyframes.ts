/**
 * keyframes 命令(2026-10-17,Task 7):list/set/move/delete——显式关键帧
 * 读取、创建、移动和删除。
 *
 * 参数统一为 {objectId, propPath: string[]}(点路径的数组形式,如
 * ['position','x']);propPath 必须指向简单叶子(compound/未知路径
 * INVALID_ARGUMENT)。set/move/delete 是项目命令(mutation/project、
 * undoable:single-step、completion:committed),接受 expectedRevision
 * 乐观并发——校验(对象 → 叶子 → 值形状 → 源关键帧)全部先于 revision
 * 检查与事务,与 objects.update 同序。
 *
 * snap 约定同 sequence.seek:snap:true 先用 closestGridPosition 吸附,
 * 默认 false 原样。轨道访问全部经 keyframeTracks 适配层。
 */
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import {AgentApiError} from '../errors'
import {
  deleteKeyframe,
  findKeyframeAt,
  listKeyframes,
  moveKeyframe,
  setKeyframe,
} from '../keyframeTracks'
import type {KeyframeInfo} from '../keyframeTracks'
import {resolveSceneSheetObject} from '../objectResolver'
import {isPropSequenced} from '../propAccess'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import type {JsonSchema} from '../types'
import {requireFiniteNumber, requireObject, requireString} from '../validation'

export type {KeyframeInfo} from '../keyframeTracks'

/** 关键帧门面(Task 15 由同名命令转发实现) */
export type KeyframesApi = {
  list(args: {objectId: string; propPath: string[]}): Promise<KeyframeInfo[]>
  set(args: {
    objectId: string
    propPath: string[]
    at: number
    value: unknown
    snap?: boolean
    expectedRevision?: number
  }): Promise<{revision: number}>
  move(args: {
    objectId: string
    propPath: string[]
    from: number
    to: number
    snap?: boolean
    expectedRevision?: number
  }): Promise<{revision: number}>
  delete(args: {
    objectId: string
    propPath: string[]
    at: number
    snap?: boolean
    expectedRevision?: number
  }): Promise<{revision: number}>
}

type TargetArgs = {objectId: string; propPath: string[]}
type SetArgs = TargetArgs & {
  at: number
  value: unknown
  snap: boolean
  expectedRevision?: number
}
type MoveArgs = TargetArgs & {
  from: number
  to: number
  snap: boolean
  expectedRevision?: number
}
type DeleteArgs = TargetArgs & {
  at: number
  snap: boolean
  expectedRevision?: number
}

const objectTargetProperties: Record<string, JsonSchema> = {
  objectId: {type: 'string', description: '带类型场景对象 ID,如 model:Y Bot'},
  propPath: {
    type: 'array',
    items: {type: 'string'},
    description: '简单叶子的属性路径分段,如 ["position","x"]',
  },
}

const snapProperty: JsonSchema = {
  type: 'boolean',
  description: '先按序列网格吸附位置再写入,默认 false',
}

const expectedRevisionProperty: JsonSchema = {
  type: 'number',
  description: '乐观并发:读取场景时的 revision',
}

const keyframeListOutput: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      position: {type: 'number'},
      value: {description: '关键帧值(简单叶子的标量)'},
    },
    required: ['position', 'value'],
  },
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

function requirePropPath(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((segment) => typeof segment !== 'string' || segment.length === 0)
  ) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      'propPath 必须是非空字符串数组,如 ["position","x"]',
    )
  }
  return value as string[]
}

function optionalSnap(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new AgentApiError('INVALID_ARGUMENT', 'snap 必须是布尔值')
  }
  return value
}

function optionalExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return requireFiniteNumber(value, 'expectedRevision')
}

function validateTarget(value: unknown): TargetArgs {
  const args = requireObject(value)
  return {
    objectId: requireString(args, 'objectId'),
    propPath: requirePropPath(args.propPath),
  }
}

function validateSet(value: unknown): SetArgs {
  const target = validateTarget(value)
  const args = value as Record<string, unknown>
  if (!('value' in args)) {
    throw new AgentApiError('INVALID_ARGUMENT', 'value 必填')
  }
  return {
    ...target,
    at: requireFiniteNumber(args.at, 'at'),
    value: args.value,
    snap: optionalSnap(args.snap),
    expectedRevision: optionalExpectedRevision(args.expectedRevision),
  }
}

function validateMove(value: unknown): MoveArgs {
  const target = validateTarget(value)
  const args = value as Record<string, unknown>
  return {
    ...target,
    from: requireFiniteNumber(args.from, 'from'),
    to: requireFiniteNumber(args.to, 'to'),
    snap: optionalSnap(args.snap),
    expectedRevision: optionalExpectedRevision(args.expectedRevision),
  }
}

function validateDelete(value: unknown): DeleteArgs {
  const target = validateTarget(value)
  const args = value as Record<string, unknown>
  return {
    ...target,
    at: requireFiniteNumber(args.at, 'at'),
    snap: optionalSnap(args.snap),
    expectedRevision: optionalExpectedRevision(args.expectedRevision),
  }
}

/**
 * 解析对象并校验 propPath 指向简单叶子:对象不存在 OBJECT_NOT_FOUND、
 * 类型不符 INVALID_ID_KIND、未挂载 INVALID_STATE;路径未知或指向
 * compound 抛 INVALID_ARGUMENT。返回叶子当前求值供值形状校验。
 */
function resolveSimpleLeaf(
  runtime: AgentRuntime,
  objectId: string,
  propPath: string[],
): {sheetObject: ISheetObject<$IntentionalAny>; current: unknown} {
  const sheetObject = resolveSceneSheetObject(runtime.sheet, objectId)
  if (!sheetObject) {
    throw new AgentApiError(
      'INVALID_STATE',
      `对象未挂载,无法操作关键帧: ${objectId}`,
      {details: {objectId}},
    )
  }
  let current = sheetObject.value as unknown
  for (const segment of propPath) {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `未知属性路径: ${propPath.join('.')}`,
        {details: {objectId, propPath}},
      )
    }
    current = (current as Record<string, unknown>)[segment]
  }
  if (
    typeof current !== 'number' &&
    typeof current !== 'string' &&
    typeof current !== 'boolean'
  ) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `propPath 必须指向简单叶子属性: ${propPath.join('.')}`,
      {details: {objectId, propPath}},
    )
  }
  return {sheetObject, current}
}

/** 值形状与叶子当前简单值类型匹配(数字须有限) */
function assertValueMatchesLeaf(
  label: string,
  current: unknown,
  value: unknown,
): void {
  if (typeof current === 'number') {
    requireFiniteNumber(value, label)
    return
  }
  if (typeof value !== typeof current) {
    throw new AgentApiError(
      'INVALID_ARGUMENT',
      `${label} 必须是 ${typeof current} 类型`,
    )
  }
}

function keyframeNotFound(propPath: string[], position: number): AgentApiError {
  return new AgentApiError(
    'KEYFRAME_NOT_FOUND',
    `位置 ${position} 没有关键帧: ${propPath.join('.')}`,
    {details: {propPath, position}},
  )
}

export function registerKeyframeCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<TargetArgs, KeyframeInfo[]>({
    name: 'keyframes.list',
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
    inputSchema: {
      type: 'object',
      properties: objectTargetProperties,
      required: ['objectId', 'propPath'],
      additionalProperties: false,
    },
    outputSchema: keyframeListOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
    ],
    validate: validateTarget,
    execute: async (args) => {
      runtime.assertActive()
      const {sheetObject} = resolveSimpleLeaf(
        runtime,
        args.objectId,
        args.propPath,
      )
      return listKeyframes(runtime.sheet, sheetObject, args.propPath)
    },
  })

  registry.register<SetArgs, {revision: number}>({
    name: 'keyframes.set',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        ...objectTargetProperties,
        at: {type: 'number', description: '关键帧位置(秒)'},
        value: {description: '关键帧值,形状与叶子当前值一致'},
        snap: snapProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'propPath', 'at', 'value'],
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
    validate: validateSet,
    execute: async (args) => {
      runtime.assertActive()
      const {sheetObject, current} = resolveSimpleLeaf(
        runtime,
        args.objectId,
        args.propPath,
      )
      assertValueMatchesLeaf(args.propPath.join('.'), current, args.value)
      const sequenced = isPropSequenced(sheetObject, args.propPath.join('.'))
      const sequence = runtime.sheet.sequence
      const at = args.snap ? sequence.closestGridPosition(args.at) : args.at
      // 全部校验先于乐观并发与事务(同 objects.update)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setKeyframe(runtime.sheet, sheetObject, args.propPath, {
        position: at,
        value: args.value,
        sequenced,
      })
      // historic 通知可能尚未在同一调用栈触发;返回当前值,不手工加一
      return {revision: runtime.revision}
    },
  })

  registry.register<MoveArgs, {revision: number}>({
    name: 'keyframes.move',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        ...objectTargetProperties,
        from: {type: 'number', description: '源关键帧位置(秒)'},
        to: {type: 'number', description: '目标位置(秒)'},
        snap: snapProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'propPath', 'from', 'to'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'KEYFRAME_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateMove,
    execute: async (args) => {
      runtime.assertActive()
      const {sheetObject} = resolveSimpleLeaf(
        runtime,
        args.objectId,
        args.propPath,
      )
      const sequence = runtime.sheet.sequence
      const from = args.snap
        ? sequence.closestGridPosition(args.from)
        : args.from
      const to = args.snap ? sequence.closestGridPosition(args.to) : args.to
      const target = findKeyframeAt(
        runtime.sheet,
        sheetObject,
        args.propPath,
        from,
      )
      if (!target) throw keyframeNotFound(args.propPath, from)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      moveKeyframe(runtime.sheet, sheetObject, target, {from, to})
      return {revision: runtime.revision}
    },
  })

  registry.register<DeleteArgs, {revision: number}>({
    name: 'keyframes.delete',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: {
      type: 'object',
      properties: {
        ...objectTargetProperties,
        at: {type: 'number', description: '要删除的关键帧位置(秒)'},
        snap: snapProperty,
        expectedRevision: expectedRevisionProperty,
      },
      required: ['objectId', 'propPath', 'at'],
      additionalProperties: false,
    },
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'INVALID_ID_KIND',
      'OBJECT_NOT_FOUND',
      'INVALID_STATE',
      'KEYFRAME_NOT_FOUND',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateDelete,
    execute: async (args) => {
      runtime.assertActive()
      const {sheetObject} = resolveSimpleLeaf(
        runtime,
        args.objectId,
        args.propPath,
      )
      const sequence = runtime.sheet.sequence
      const at = args.snap ? sequence.closestGridPosition(args.at) : args.at
      // 先确认该位置确有关键帧:否则 core 的 unset 会落到静态覆盖上
      const target = findKeyframeAt(
        runtime.sheet,
        sheetObject,
        args.propPath,
        at,
      )
      if (!target) throw keyframeNotFound(args.propPath, at)
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      deleteKeyframe(runtime.sheet, sheetObject, args.propPath, {position: at})
      return {revision: runtime.revision}
    },
  })
}
