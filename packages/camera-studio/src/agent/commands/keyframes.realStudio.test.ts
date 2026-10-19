/* eslint-disable import/no-extraneous-dependencies */
/**
 * keyframes.set 首次建轨的真实 Studio 行为测试(2026-10-17,Ruling 1):
 * 第一次 keyframes.set 必须真正落下关键帧——随后 keyframes.list 能读到
 * 新的 {position,value};且整个调用对撤销历史只呈现一步(建轨事务
 * undoable:false,一次 undo 后帧消失、轨道保留)。
 *
 * 与 keyframes.test.ts(假事务,验调用形状)互补:本文件用真实 Studio
 * (同 studio integration-tests 的引导方式)验端到端落库。
 */
import '@dreamerbird/studio'
import theatre, {getProject, types as t, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {globals} from '@dreamerbird/core/globals'
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import type {Pointer} from '@dreamerbird/dataverse'
import getStudio from '@dreamerbird/studio/getStudio'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import type {CommandContext} from '../types'
import {registerKeyframeCommands} from './keyframes'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

let projectSeq = 0

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

/** 探 saaz 撤销栈(私有路径,同 studio undoHistory.test.ts 的取证方式) */
const undoStackOf = (): unknown[] => {
  const s = studio as unknown as {_store?: {_saaz?: unknown}; _saaz?: unknown}
  const saaz = (s._store?._saaz ?? s._saaz) as
    | {_atom?: {get?: () => {undoRedo?: {stack?: unknown[]}}}}
    | undefined
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

test('首次 keyframes.set 真正落帧:list 读到新帧;撤销历史只增一步,undo 后帧消轨存', async () => {
  const project = getProject(`agent-kf-real-${++projectSeq}`, {
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
  await project.ready
  const sheet = project.sheet('Scene')

  const registryObj = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registryObj.initialValue = {
    list: JSON.stringify([{key: 'Foo', position: {x: 0, y: 0, z: 0}}]),
  }
  const obj = sheet.object('Foo', {
    position: t.compound({x: t.number(0), y: t.number(0), z: t.number(0)}),
  }) as ISheetObject<never>
  objectRuntime.registerSceneSheetObject('model:Foo', obj)

  try {
    const runtime = createAgentRuntime({
      project,
      sheet,
      library: {} as never,
      getStudio: () => studio as never,
      subscribeHistoric: () => () => {},
    })
    const registry = new AgentCommandRegistry()
    registerKeyframeCommands(registry, runtime)

    const stackBefore = undoStackOf().length

    await registry.execute(
      'keyframes.set',
      {objectId: 'model:Foo', propPath: ['position', 'x'], at: 0.5, value: 7},
      ctx(),
    )

    // 核心断言:第一次 set 之后,list 立即读到真实落库的关键帧
    const listed = await registry.execute(
      'keyframes.list',
      {objectId: 'model:Foo', propPath: ['position', 'x']},
      ctx(),
    )
    expect(listed).toEqual([{position: 0.5, value: 7}])
    expect(sheet.sequence.position).toBe(0.5)

    // 两笔底层事务,但撤销栈只增一步(建轨 undoable:false)
    expect(undoStackOf().length).toBe(stackBefore + 1)

    // 一次 undo:关键帧被撤销,轨道保留(建轨事务不入栈)
    studio.undo()
    const afterUndo = await registry.execute(
      'keyframes.list',
      {objectId: 'model:Foo', propPath: ['position', 'x']},
      ctx(),
    )
    expect(afterUndo).toEqual([])
    const tracksP = (privateAPI(project) as $IntentionalAny).pointers.historic
      .sheetsById.Scene.sequence.tracksByObject.Foo as Pointer<$IntentionalAny>
    const tracksOfFoo = val(tracksP) as
      | {trackIdByPropPath: Record<string, string>}
      | undefined
    expect(Object.keys(tracksOfFoo?.trackIdByPropPath ?? {})).toEqual([
      '["position","x"]',
    ])
  } finally {
    objectRuntime.unregisterSceneSheetObject('model:Foo', obj)
  }
}, 20000)
