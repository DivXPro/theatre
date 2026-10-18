/* eslint-disable import/no-extraneous-dependencies */
/**
 * revision 返回时机的真实 Studio 行为测试(2026-10-19,F2 修复):
 * 写命令(含 history.undo/redo)同步读 runtime.revision 拿到的是
 * 写入前的值——historic 指针的 onChange 监听经 prism.onChange 排到
 * core ticker 的下一 tick(prism.ts onThisOrNextTick),只有第一次
 * 事务在 node 环境恰遇 dormant→active 的 start() 补 tick 才碰巧同步。
 * 修复:写命令一律等一个 core tick 再读,返回值反映本次写入,
 * expectedRevision 链式调用不错误冲突。
 *
 * 与 objects.test.ts / history.test.ts(假 Studio,验调用形状)互补:
 * 本文件用真实 historic 订阅(onChange(pointers.historic))验端到端。
 */
import '@dreamerbird/studio'
import theatre, {getProject, onChange, types as t, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import {globals} from '@dreamerbird/core/globals'
import type {ISheetObject} from '@dreamerbird/core'
import getStudio from '@dreamerbird/studio/getStudio'
import {getCoreTicker} from '@dreamerbird/core/coreTicker'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import * as objectRuntime from '../runtime/objectRuntime'
import type {CommandContext} from '../types'
import {registerHistoryCommands} from './history'
import {registerObjectCommands} from './objects'

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

let projectSeq = 0

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function setup() {
  const project = getProject(`agent-revision-real-${++projectSeq}`, {
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
  const obj = sheet.object('Foo', {
    position: t.compound({x: t.number(1), y: t.number(2), z: t.number(3)}),
  }) as ISheetObject<never>
  objectRuntime.registerSceneSheetObject('model:Foo', obj as never)
  cleanups.push(() =>
    objectRuntime.unregisterSceneSheetObject('model:Foo', obj as never),
  )
  // 真实 historic 订阅:revision 只随 onChange(pointers.historic) 通知递增
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => studio as never,
    subscribeHistoric: (listener) =>
      onChange(privateAPI(project).pointers.historic, () => listener()),
  })
  const registry = new AgentCommandRegistry()
  registerObjectCommands(registry, runtime)
  registerHistoryCommands(registry, runtime)
  return {project, runtime, registry, obj: obj as ISheetObject<any>}
}

test('机制佐证:historic 通知是 tick 调度的,事务后同步读拿到写入前的值', async () => {
  const {project, runtime, obj} = setup()
  await project.ready
  // 打底一笔 + 冲刷:排除 dormant→active 时 start() 同步补 tick 的特例,
  // 进入生产的常态(ticker active,通知排下一 tick)
  studio.transaction(({set}) => set(obj.props.position, {x: 0, y: 0, z: 0}))
  getCoreTicker().tick()

  const before = runtime.revision
  studio.transaction(({set}) => set(obj.props.position, {x: 9, y: 9, z: 9}))
  // 通知尚未触发:同步读滞后一笔(修复前写命令返回的就是这个过期值)
  expect(runtime.revision).toBe(before)
  getCoreTicker().tick()
  expect(runtime.revision).toBe(before + 1)
})

test('写命令返回写入后的 revision,expectedRevision 可连续链式写入', async () => {
  const {project, runtime, registry, obj} = setup()
  await project.ready
  const baseline = runtime.revision

  const u1 = (await registry.execute(
    'objects.update',
    {objectId: 'model:Foo', props: {position: {x: 5, y: 0, z: 0}}},
    ctx(),
  )) as {revision: number}
  expect(u1.revision).toBe(baseline + 1)

  // 链式:上一笔的返回 revision 直接作下一笔的 expectedRevision
  const u2 = (await registry.execute(
    'objects.update',
    {
      objectId: 'model:Foo',
      props: {position: {x: 6, y: 0, z: 0}},
      expectedRevision: u1.revision,
    },
    ctx(),
  )) as {revision: number}
  expect(u2.revision).toBe(u1.revision + 1)

  const u3 = (await registry.execute(
    'objects.update',
    {
      objectId: 'model:Foo',
      props: {position: {x: 7, y: 0, z: 0}},
      expectedRevision: u2.revision,
    },
    ctx(),
  )) as {revision: number}
  expect(u3.revision).toBe(u2.revision + 1)
  expect(val(obj.props.position)).toEqual({x: 7, y: 0, z: 0})
})

test('history.undo 返回 undo 后的 revision;可继续链式写入', async () => {
  const {project, registry, obj} = setup()
  await project.ready

  const u1 = (await registry.execute(
    'objects.update',
    {objectId: 'model:Foo', props: {position: {x: 5, y: 0, z: 0}}},
    ctx(),
  )) as {revision: number}
  expect(val(obj.props.position)).toEqual({x: 5, y: 0, z: 0})

  // undo 也改 historic:返回 revision 必须反映 undo 本身
  const u2 = (await registry.execute(
    'history.undo',
    {expectedRevision: u1.revision},
    ctx(),
  )) as {revision: number}
  expect(u2.revision).toBe(u1.revision + 1)
  expect(val(obj.props.position)).toEqual({x: 1, y: 2, z: 3})

  // undo 后的 revision 可直接续链
  await expect(
    registry.execute(
      'objects.update',
      {
        objectId: 'model:Foo',
        props: {position: {x: 8, y: 0, z: 0}},
        expectedRevision: u2.revision,
      },
      ctx(),
    ),
  ).resolves.toMatchObject({revision: u2.revision + 1})
})
