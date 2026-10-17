/* eslint-disable import/no-extraneous-dependencies */
/**
 * poses.clear 的真实 Studio 行为测试(2026-10-17,Task 9):
 * 「单事务 unsequenceProp + unset」用 stateEditors 直改 historic 实现
 * (绕开指针级 unset 读事务前轨道树的已知限制,CameraScene 2026-10-01
 * 冒烟记录),必须验证:
 *   1. 已建轨姿势:一次 clear 后轨道删除、值回默认、撤销栈只增一步,
 *      undo 后轨道与值一并恢复;
 *   2. 纯静态姿势:clear 后值清空、只增一步,undo 恢复;
 *   3. 空姿势:不产生任何事务(栈长不变),返回 cleared:false。
 *
 * 与 poses.test.ts(假事务,验调用形状)互补:本文件用真实 Studio
 * (同 keyframes.realStudio.test.ts 的引导方式)验端到端落库与撤销粒度。
 */
import '@dreamerbird/studio'
import theatre, {getProject, onChange, types as t, val} from '@dreamerbird/core'
import {globals} from '@dreamerbird/core/globals'
import type {ISheetObject} from '@dreamerbird/core'
import getStudio from '@dreamerbird/studio/getStudio'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import {getPoseTrackId} from '../../poseMode/poseTrack'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import type {CommandContext} from '../types'
import {registerPoseCommands} from './poses'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

let projectSeq = 0

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

/** 探 saaz 撤销栈(私有路径,同 keyframes.realStudio.test.ts 的取证方式) */
const undoStackOf = (): unknown[] => {
  const s = studio as unknown as {_store?: {_saaz?: unknown}; _saaz?: unknown}
  const saaz = (s._store?._saaz ?? s._saaz) as
    | {_atom?: {get?: () => {undoRedo?: {stack?: unknown[]}}}}
    | undefined
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

const POSE_JSON = JSON.stringify({kind: 'lib', id: 'pose-1'})

function setup() {
  const project = getProject(`agent-poses-real-${++projectSeq}`, {
    state: {
      definitionVersion: globals.currentProjectStateDefinitionVersion,
      sheetsById: {
        Scene: {
          staticOverrides: {byObject: {}},
          sequence: {
            type: 'PositionalSequence',
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    } as never,
  })
  getCoreTicker().tick()
  const sheet = project.sheet('Scene')
  const registryObj = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registryObj.initialValue = {
    list: JSON.stringify([{key: 'Foo', position: {x: 0, y: 0, z: 0}}]),
  }
  const obj = sheet.object('Foo', {pose: t.string('')}) as ISheetObject<never>
  objectRuntime.registerSceneSheetObject('model:Foo', obj)
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => studio as never,
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerPoseCommands(registry, runtime)
  return {
    project,
    sheet,
    registry,
    obj: obj as ISheetObject<any>,
    cleanup: () => objectRuntime.unregisterSceneSheetObject('model:Foo', obj),
  }
}

test('已建轨姿势:clear 删轨清值只占一个撤销步骤,undo 一并恢复', async () => {
  const {project, sheet, registry, obj, cleanup} = setup()
  // 序列层在 prism.effect 里合并,冷求值(裸 val)不跑 effect 恒得静态值——
  // 必须挂订阅让棱镜转热,用订阅收到的最新值当「当前值」
  const seen: string[] = []
  const unsub = onChange(obj.props.pose as never, (v: string) => {
    seen.push(v)
  })
  const currentPose = () => seen[seen.length - 1]
  try {
    await project.ready
    // 建轨(内部事务 api 无 sequenceProp——那是公共包装的产物;直用
    // stateEditors,同 keyframeTracks.setKeyframe 的建轨通道)+ 写帧
    studio.transaction(({stateEditors}) => {
      stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsSequenced(
        {
          projectId: obj.address.projectId,
          sheetId: obj.address.sheetId,
          objectKey: obj.address.objectKey,
          pathToProp: ['pose'],
        },
      )
    })
    sheet.sequence.position = 1
    studio.transaction(({set}) => {
      set(obj.props.pose, POSE_JSON)
    })
    getCoreTicker().tick()
    expect(getPoseTrackId(obj)).toBeDefined()
    expect(currentPose()).toBe(POSE_JSON)

    const stackBefore = undoStackOf().length
    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )
    getCoreTicker().tick()
    expect(result).toMatchObject({cleared: true})

    // 轨道删除、值回默认;撤销栈只增一步
    expect(getPoseTrackId(obj)).toBeUndefined()
    expect(currentPose()).toBe('')
    expect(undoStackOf().length).toBe(stackBefore + 1)

    // 一次 undo:轨道与姿势值一并恢复
    studio.undo()
    getCoreTicker().tick()
    expect(getPoseTrackId(obj)).toBeDefined()
    expect(currentPose()).toBe(POSE_JSON)
  } finally {
    unsub()
    cleanup()
  }
}, 20000)

test('纯静态姿势:clear 清值占一步,undo 恢复', async () => {
  const {project, registry, obj, cleanup} = setup()
  try {
    await project.ready
    studio.transaction(({set}) => {
      set(obj.props.pose, POSE_JSON)
    })
    expect(val(obj.props.pose)).toBe(POSE_JSON)

    const stackBefore = undoStackOf().length
    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )
    expect(result).toMatchObject({cleared: true})
    expect(val(obj.props.pose)).toBe('')
    expect(undoStackOf().length).toBe(stackBefore + 1)

    studio.undo()
    expect(val(obj.props.pose)).toBe(POSE_JSON)
  } finally {
    cleanup()
  }
}, 20000)

test('空姿势:不进事务(栈长不变),返回 cleared:false', async () => {
  const {project, registry, cleanup} = setup()
  try {
    await project.ready
    const stackBefore = undoStackOf().length
    const result = await registry.execute(
      'poses.clear',
      {objectId: 'model:Foo'},
      ctx(),
    )
    expect(result).toMatchObject({cleared: false})
    expect(undoStackOf().length).toBe(stackBefore)
  } finally {
    cleanup()
  }
}, 20000)
