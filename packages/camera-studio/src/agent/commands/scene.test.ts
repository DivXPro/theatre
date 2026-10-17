/**
 * scene.getSnapshot / objects.list / objects.get(Task 4):
 * 无副作用是核心契约 —— 查询只用 privateAPI(sheet).getObject 探测,
 * 绝不创建注册表/路径对象,historic 状态序列化前后一致。
 * 注册表有条目但运行时未挂载 → props:null, mounted:false,
 * 而不是误报 OBJECT_NOT_FOUND。
 */
import {getProject, types as t, val} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import type {IProject, ISheet, ISheetObject} from '@dreamerbird/core'
import {pathExists} from '../../CameraPath'
import {CAMERAS_REGISTRY_KEY} from '../../cameraRegistry'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import {
  registerSceneSheetObject,
  unregisterSceneSheetObject,
} from '../runtime/objectRuntime'
import type {CommandContext} from '../types'
import {registerSceneCommands} from './scene'

let projectSeq = 0

function makeScene() {
  const project = getProject(`agent-scene-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => undefined,
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerSceneCommands(registry, runtime)
  return {project, sheet, registry, runtime}
}

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

const REGISTRY_KEYS = ['Placements', 'Cameras', 'Anchors', 'Paths'] as const

/** 四个业务注册表对象的存活探测(只读,不创建) */
function peekRegistries(sheet: ISheet): boolean[] {
  return REGISTRY_KEYS.map((key) =>
    Boolean((privateAPI(sheet) as any).getObject(key)),
  )
}

/** historic 状态序列化:无副作用断言的底账 */
function historicJson(project: IProject): string {
  return JSON.stringify(val((privateAPI(project) as any).pointers.historic))
}

/** 测试布景:直接建注册表对象并写清单(initialValue 不需要 studio) */
function seedPlacements(
  sheet: ISheet,
  entries: Array<{key: string; position: {x: number; y: number; z: number}}>,
) {
  const registry = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registry.initialValue = {list: JSON.stringify(entries)}
}

test('空场景查询无副作用:不创建注册表,不改 historic 状态', async () => {
  const {project, sheet, registry} = makeScene()
  expect(peekRegistries(sheet)).toEqual([false, false, false, false])
  const historicBefore = historicJson(project)

  const snapshot = await registry.execute('scene.getSnapshot', {}, ctx())
  expect(snapshot).toEqual({revision: 1, objects: []})
  const list = await registry.execute('objects.list', {}, ctx())
  expect(list).toEqual([])

  expect(peekRegistries(sheet)).toEqual([false, false, false, false])
  expect(historicJson(project)).toBe(historicBefore)
})

test('objects.get 不存在的路径:OBJECT_NOT_FOUND,且不创建路径对象', async () => {
  const {sheet, registry} = makeScene()
  expect(pathExists(sheet, 'missing')).toBe(false)
  await expect(
    registry.execute('objects.get', {objectId: 'path:missing'}, ctx()),
  ).rejects.toMatchObject({
    code: 'OBJECT_NOT_FOUND',
    details: {objectId: 'path:missing', kind: 'path'},
  })
  expect(pathExists(sheet, 'missing')).toBe(false)
})

test('objects.get 无效 ID 前缀返回 INVALID_ID_KIND', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('objects.get', {objectId: 'foo:A'}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
})

test('objects.get 注册表里没有的模型:OBJECT_NOT_FOUND,details 含 objectId/kind', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('objects.get', {objectId: 'model:Nope'}, ctx()),
  ).rejects.toMatchObject({
    code: 'OBJECT_NOT_FOUND',
    details: {objectId: 'model:Nope', kind: 'model'},
  })
})

test('注册表有条目但运行时未挂载:props:null, mounted:false', async () => {
  const {sheet, registry} = makeScene()
  seedPlacements(sheet, [{key: 'Foo', position: {x: 1, y: 2, z: 3}}])

  const got = await registry.execute(
    'objects.get',
    {objectId: 'model:Foo'},
    ctx(),
  )
  expect(got).toEqual({
    id: 'model:Foo',
    kind: 'model',
    key: 'Foo',
    props: null,
    mounted: false,
  })
  const list = await registry.execute('objects.list', {}, ctx())
  expect(list).toEqual([
    {id: 'model:Foo', kind: 'model', key: 'Foo', props: null, mounted: false},
  ])
})

test('已挂载对象返回当前求值属性的深拷贝', async () => {
  const {sheet, registry} = makeScene()
  seedPlacements(sheet, [{key: 'Foo', position: {x: 0, y: 0, z: 0}}])
  const obj = sheet.object('Foo', {
    position: t.compound({x: t.number(1), y: t.number(2), z: t.number(3)}),
  })
  registerSceneSheetObject('model:Foo', obj as ISheetObject<any>)
  try {
    const got = (await registry.execute(
      'objects.get',
      {objectId: 'model:Foo'},
      ctx(),
    )) as {mounted: boolean; props: {position: {x: number}}}
    expect(got.mounted).toBe(true)
    expect(got.props).toEqual({position: {x: 1, y: 2, z: 3}})
    // 深拷贝:改返回值不得影响 theatre 对象本体
    got.props.position.x = 99
    expect(obj.value.position.x).toBe(1)
  } finally {
    unregisterSceneSheetObject('model:Foo', obj as ISheetObject<any>)
  }
})

test('快照带 revision 且涵盖四种业务对象', async () => {
  const {sheet, registry} = makeScene()
  seedPlacements(sheet, [{key: 'Foo', position: {x: 0, y: 0, z: 0}}])
  const cameras = sheet.object(
    CAMERAS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  cameras.initialValue = {list: JSON.stringify([{cameraKey: 'Cam 1'}])}

  const snapshot = (await registry.execute('scene.getSnapshot', {}, ctx())) as {
    revision: number
    objects: Array<{id: string}>
  }
  expect(snapshot.revision).toBe(1)
  expect(snapshot.objects.map((o) => o.id)).toEqual([
    'model:Foo',
    'camera:Cam 1',
  ])
})

test('会话销毁后查询返回 API_DISPOSED', async () => {
  const {registry, runtime} = makeScene()
  runtime.dispose()
  await expect(
    registry.execute('scene.getSnapshot', {}, ctx()),
  ).rejects.toMatchObject({code: 'API_DISPOSED'})
  await expect(
    registry.execute('objects.list', {}, ctx()),
  ).rejects.toMatchObject({code: 'API_DISPOSED'})
})

test('describe() 中查询命令标记 query/project', () => {
  const {registry} = makeScene()
  const described = registry.describe()
  const byName = new Map(described.commands.map((c) => [c.name, c]))
  for (const name of ['scene.getSnapshot', 'objects.list', 'objects.get']) {
    const command = byName.get(name)
    expect(command).toBeDefined()
    expect(command).toMatchObject({
      kind: 'query',
      stateDomain: 'project',
      undoable: 'none',
    })
  }
})
