/**
 * selection.get / selectObject / clear(Task 4):session 域 mutation,
 * undoable:none。选择解析只认 objectRuntime 里登记的四种业务对象;
 * 清空同时通知 Scene Runtime 清理路径控制点选择。
 */
import {getProject, types as t} from '@dreamerbird/core'
import type {ISheet, ISheetObject, IStudio} from '@dreamerbird/core'
import {CAMERAS_REGISTRY_KEY} from '../../cameraRegistry'
import {PLACEMENTS_REGISTRY_KEY} from '../../PlacementManager'
import {resolveSceneSheetObject} from '../objectResolver'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import {
  registerSceneSheetObject,
  unregisterSceneSheetObject,
} from '../runtime/objectRuntime'
import type {CommandContext} from '../types'
import {registerSelectionCommands} from './selection'

let projectSeq = 0

function makeScene({withStudio = true}: {withStudio?: boolean} = {}) {
  const project = getProject(`agent-selection-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  let selection: unknown[] = []
  const setSelection = jest.fn((next: unknown[]) => {
    selection = [...next]
  })
  const studio = {
    get selection() {
      return selection
    },
    setSelection,
  }
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => (withStudio ? (studio as unknown as IStudio) : undefined),
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerSelectionCommands(registry, runtime)
  return {
    project,
    sheet,
    registry,
    runtime,
    studio: studio as unknown as IStudio,
    setSelection,
  }
}

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

function seedPlacements(sheet: ISheet, keys: string[]) {
  const registry = sheet.object(
    PLACEMENTS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registry.initialValue = {
    list: JSON.stringify(
      keys.map((key) => ({key, position: {x: 0, y: 0, z: 0}})),
    ),
  }
}

function seedCameras(sheet: ISheet, cameraKeys: string[]) {
  const registry = sheet.object(
    CAMERAS_REGISTRY_KEY,
    {list: t.string('[]')},
    {hideFromOutline: true},
  )
  registry.initialValue = {
    list: JSON.stringify(cameraKeys.map((cameraKey) => ({cameraKey}))),
  }
}

function expectErrorCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({code})
    return
  }
  throw new Error(`Expected ${code}`)
}

test('selectObject 选中登记的模型 SheetObject', async () => {
  const {sheet, registry, setSelection, studio} = makeScene()
  seedPlacements(sheet, ['A'])
  const objA = {address: {objectKey: 'A'}} as unknown as ISheetObject<any>
  registerSceneSheetObject('model:A', objA)
  try {
    await registry.execute(
      'selection.selectObject',
      {objectId: 'model:A'},
      ctx(),
    )
    expect(setSelection).toHaveBeenCalledWith([objA])
    expect(studio.selection).toEqual([objA])
  } finally {
    unregisterSceneSheetObject('model:A', objA)
  }
})

test('selectObject 不存在的对象返回 OBJECT_NOT_FOUND', async () => {
  const {registry, setSelection} = makeScene()
  await expect(
    registry.execute(
      'selection.selectObject',
      {objectId: 'model:Missing'},
      ctx(),
    ),
  ).rejects.toMatchObject({
    code: 'OBJECT_NOT_FOUND',
    details: {objectId: 'model:Missing', kind: 'model'},
  })
  expect(setSelection).not.toHaveBeenCalled()
})

test('selectObject 注册表有条目但未挂载返回 INVALID_STATE', async () => {
  const {sheet, registry, setSelection} = makeScene()
  seedPlacements(sheet, ['B'])
  await expect(
    registry.execute('selection.selectObject', {objectId: 'model:B'}, ctx()),
  ).rejects.toMatchObject({
    code: 'INVALID_STATE',
    details: {objectId: 'model:B'},
  })
  expect(setSelection).not.toHaveBeenCalled()
})

test('selectObject 无效 ID 前缀返回 INVALID_ID_KIND', async () => {
  const {registry} = makeScene()
  await expect(
    registry.execute('selection.selectObject', {objectId: 'foo:A'}, ctx()),
  ).rejects.toMatchObject({code: 'INVALID_ID_KIND'})
})

test('camera:A 被当作 model 使用返回 INVALID_ID_KIND', () => {
  const {sheet} = makeScene()
  expectErrorCode(
    () => resolveSceneSheetObject(sheet, 'camera:A', 'model'),
    'INVALID_ID_KIND',
  )
})

test('selection.get 只把能解析为业务对象的选中项返回为 ID', async () => {
  const {sheet, registry, studio} = makeScene()
  seedPlacements(sheet, ['A'])
  seedCameras(sheet, ['Cam 1'])
  const objA = {address: {objectKey: 'A'}} as unknown as ISheetObject<any>
  const objCam = {address: {objectKey: 'Cam 1'}} as unknown as ISheetObject<any>
  const unrelated = {
    address: {objectKey: 'Thingy'},
  } as unknown as ISheetObject<any>
  registerSceneSheetObject('model:A', objA)
  registerSceneSheetObject('camera:Cam 1', objCam)
  try {
    studio.setSelection([objA, unrelated, objCam])
    const got = await registry.execute('selection.get', {}, ctx())
    expect(got).toEqual({objectIds: ['model:A', 'camera:Cam 1']})
  } finally {
    unregisterSceneSheetObject('model:A', objA)
    unregisterSceneSheetObject('camera:Cam 1', objCam)
  }
})

test('selection.clear 置空选择并通知 Scene Runtime 清理路径点选择', async () => {
  const {registry, runtime, setSelection} = makeScene()
  const clearPathPointSelection = jest.fn()
  runtime.bindHandlers({clearPathPointSelection})
  await registry.execute('selection.clear', {}, ctx())
  expect(setSelection).toHaveBeenCalledWith([])
  expect(clearPathPointSelection).toHaveBeenCalledTimes(1)
})

test('Studio 不可用时选择命令返回 SCENE_UNAVAILABLE', async () => {
  const {registry} = makeScene({withStudio: false})
  await expect(
    registry.execute('selection.get', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
  await expect(
    registry.execute('selection.clear', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'SCENE_UNAVAILABLE',
  })
})

test('会话销毁后选择命令返回 API_DISPOSED', async () => {
  const {registry, runtime} = makeScene()
  runtime.dispose()
  await expect(
    registry.execute('selection.clear', {}, ctx()),
  ).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
})

test('describe() 中选择命令标记 mutation/session、undoable:none', () => {
  const {registry} = makeScene()
  const described = registry.describe()
  const byName = new Map(described.commands.map((c) => [c.name, c]))
  for (const name of [
    'selection.get',
    'selection.selectObject',
    'selection.clear',
  ]) {
    const command = byName.get(name)
    expect(command).toBeDefined()
    expect(command).toMatchObject({
      kind: 'mutation',
      stateDomain: 'session',
      undoable: 'none',
    })
  }
})
