/**
 * sequence 命令(2026-10-17,Task 6):getState/play/pause/seek/setLength。
 *
 * 播放/定位是会话命令(mutation/session、undoable:none):play 先等
 * `project.ready` 再调用并等待 `sequence.play()`(core 的 promise 播完
 * 才 resolve);pause 直通 core pause;seek 只写 `sequence.position` —
 * 先 pause 与负数/超长的 clamp 都是 core 现有语义,不额外包装;
 * snap:true 先 `closestGridPosition` 吸附再写。三者都返回读回的
 * SequenceState(playing/position/length 经 `sequence.pointer` 取实时值)。
 *
 * setLength 是项目命令(mutation/project、undoable:single-step、
 * completion:committed),接受 expectedRevision 乐观并发;时长写入经
 * sequenceLength 适配走与 TransportBar 相同的 stateEditors 路径,
 * 返回当前 historic 驱动的 revision,不手工加一。
 */
import type {ISequence} from '@dreamerbird/core'
import {val} from '@dreamerbird/dataverse'
import {AgentApiError} from '../errors'
import type {AgentCommandRegistry} from '../registry'
import type {AgentRuntime} from '../runtime'
import {setSequenceLength} from '../sequenceLength'
import type {JsonSchema} from '../types'
import {requireFiniteNumber, requireObject} from '../validation'

export type SequenceState = {
  playing: boolean
  position: number
  length: number
}

/** 播放门面(Task 15 由同名命令转发实现) */
export type SequenceApi = {
  getState(): Promise<SequenceState>
  play(): Promise<SequenceState>
  pause(): Promise<SequenceState>
  seek(args: {position: number; snap?: boolean}): Promise<SequenceState>
  setLength(args: {
    length: number
    expectedRevision?: number
  }): Promise<{revision: number}>
}

const emptyInput: JsonSchema = {type: 'object', additionalProperties: false}

const sequenceStateOutput: JsonSchema = {
  type: 'object',
  properties: {
    playing: {type: 'boolean'},
    position: {type: 'number'},
    length: {type: 'number'},
  },
  required: ['playing', 'position', 'length'],
}

const revisionOutput: JsonSchema = {
  type: 'object',
  properties: {revision: {type: 'number'}},
  required: ['revision'],
}

/** 无参命令的运行时校验:允许省略参数或空对象 */
function noArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requireObject(value)
}

/** 从 sequence.pointer 读实时状态,不做缓存 */
function readSequenceState(sequence: ISequence): SequenceState {
  return {
    playing: val(sequence.pointer.playing),
    position: val(sequence.pointer.position),
    length: val(sequence.pointer.length),
  }
}

type SeekArgs = {position: number; snap: boolean}

const seekInput: JsonSchema = {
  type: 'object',
  properties: {
    position: {type: 'number', description: '目标位置(秒)'},
    snap: {
      type: 'boolean',
      description: '先按序列网格吸附再写入,默认 false',
    },
  },
  required: ['position'],
  additionalProperties: false,
}

function validateSeek(value: unknown): SeekArgs {
  const args = requireObject(value)
  const position = requireFiniteNumber(args.position, 'position')
  const rawSnap = args.snap
  if (rawSnap !== undefined && typeof rawSnap !== 'boolean') {
    throw new AgentApiError('INVALID_ARGUMENT', 'snap 必须是布尔值')
  }
  return {position, snap: rawSnap === true}
}

type SetLengthArgs = {length: number; expectedRevision?: number}

const setLengthInput: JsonSchema = {
  type: 'object',
  properties: {
    length: {type: 'number', description: '新的序列时长(秒),必须大于 0'},
    expectedRevision: {
      type: 'number',
      description: '乐观并发:读取场景时的 revision',
    },
  },
  required: ['length'],
  additionalProperties: false,
}

function validateSetLength(value: unknown): SetLengthArgs {
  const args = requireObject(value)
  const length = requireFiniteNumber(args.length, 'length')
  if (length <= 0) {
    throw new AgentApiError('INVALID_ARGUMENT', 'length 必须大于 0')
  }
  let expectedRevision: number | undefined
  if (args.expectedRevision !== undefined) {
    expectedRevision = requireFiniteNumber(
      args.expectedRevision,
      'expectedRevision',
    )
  }
  return {length, expectedRevision}
}

export function registerSequenceCommands(
  registry: AgentCommandRegistry,
  runtime: AgentRuntime,
): void {
  registry.register<Record<string, unknown>, SequenceState>({
    name: 'sequence.getState',
    kind: 'query',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: sequenceStateOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      return readSequenceState(runtime.sheet.sequence)
    },
  })

  registry.register<Record<string, unknown>, SequenceState>({
    name: 'sequence.play',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: sequenceStateOutput,
    errorCodes: ['API_DISPOSED'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      // core 要求 project.ready 之后才能播放,等待完成后再调用
      await runtime.project.ready
      runtime.assertActive()
      // 等待 sequence.play() 的返回(播放播完或被中断才 resolve)
      await runtime.sheet.sequence.play()
      return readSequenceState(runtime.sheet.sequence)
    },
  })

  registry.register<Record<string, unknown>, SequenceState>({
    name: 'sequence.pause',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: emptyInput,
    outputSchema: sequenceStateOutput,
    errorCodes: ['API_DISPOSED'],
    validate: noArgs,
    execute: async () => {
      runtime.assertActive()
      runtime.sheet.sequence.pause()
      return readSequenceState(runtime.sheet.sequence)
    },
  })

  registry.register<SeekArgs, SequenceState>({
    name: 'sequence.seek',
    kind: 'mutation',
    stateDomain: 'session',
    undoable: 'none',
    inputSchema: seekInput,
    outputSchema: sequenceStateOutput,
    errorCodes: ['API_DISPOSED', 'INVALID_ARGUMENT'],
    validate: validateSeek,
    execute: async (args) => {
      runtime.assertActive()
      const sequence = runtime.sheet.sequence
      // core 语义:写 position 前会先 pause、负数/超长会 clamp;
      // 这里只负责可选吸附并写入,返回读回的实际 position
      sequence.position = args.snap
        ? sequence.closestGridPosition(args.position)
        : args.position
      return readSequenceState(sequence)
    },
  })

  registry.register<SetLengthArgs, {revision: number}>({
    name: 'sequence.setLength',
    kind: 'mutation',
    stateDomain: 'project',
    undoable: 'single-step',
    completion: 'committed',
    inputSchema: setLengthInput,
    outputSchema: revisionOutput,
    errorCodes: [
      'API_DISPOSED',
      'INVALID_ARGUMENT',
      'REVISION_CONFLICT',
      'SCENE_UNAVAILABLE',
    ],
    validate: validateSetLength,
    execute: async (args) => {
      runtime.assertActive()
      // 乐观并发先于事务;length 的 >0/有限校验已在 validate 完成
      if (args.expectedRevision !== undefined) {
        runtime.assertRevision(args.expectedRevision)
      }
      setSequenceLength(runtime.sheet, args.length)
      // historic 通知 tick 调度:等一个 tick,返回反映本次写入的 revision
      return {revision: await runtime.nextRevision()}
    },
  })
}
