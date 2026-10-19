/**
 * project 命令(2026-10-17,Task 12):project.exportState。
 *
 * query/project、undoable:none:调用 studio.createContentOfSaveFile(
 * project.address.projectId) 导出 Theatre 项目存档,返回深拷贝——
 * 调用方改返回值不得污染 studio 内部状态。存档只表示 Theatre 项目
 * 状态:不含 Library 资产条目、活动相机、PIP 等会话态(spec 9.3),
 * 这些字段也绝不会出现在返回结构上。Studio 未初始化返回
 * API_NOT_READY(不静默成功)。
 *
 * 布景同 selection.test.ts:真实 core project + 注入式假 studio,
 * node 环境。
 */
import {getProject} from '@dreamerbird/core'
import type {IStudio} from '@dreamerbird/core'
import {AgentCommandRegistry} from '../registry'
import {createAgentRuntime} from '../runtime'
import type {CommandContext} from '../types'
import {registerProjectCommands} from './project'

let projectSeq = 0

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const ctx = (): CommandContext => ({
  requestId: 'test',
  signal: new AbortController().signal,
})

/** 假存档内容:嵌套结构,验证深拷贝与调用参数 */
function fakeSaveFileContent() {
  return {
    definitionVersion: '2026.10.17',
    revisionHistory: ['r1'],
    sheetsById: {
      Scene: {
        staticOverrides: {byObject: {'Y Bot': {position: {x: 1, y: 0, z: 2}}}},
        sequence: {
          type: 'PositionalSequence',
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: {},
        },
      },
    },
  }
}

function makeScene({withStudio = true}: {withStudio?: boolean} = {}) {
  const project = getProject(`agent-project-${++projectSeq}`)
  const sheet = project.sheet('Scene')
  const content = fakeSaveFileContent()
  const createContentOfSaveFile = jest.fn(() => content)
  const studio = {createContentOfSaveFile}
  const runtime = createAgentRuntime({
    project,
    sheet,
    library: {} as never,
    getStudio: () => (withStudio ? (studio as unknown as IStudio) : undefined),
    subscribeHistoric: () => () => {},
  })
  const registry = new AgentCommandRegistry()
  registerProjectCommands(registry, runtime)
  cleanups.push(() => runtime.dispose())
  return {project, registry, runtime, content, createContentOfSaveFile}
}

test('exportState 以项目 ID 调 createContentOfSaveFile 并返回存档内容', async () => {
  const {project, registry, content, createContentOfSaveFile} = makeScene()
  const result = (await registry.execute('project.exportState', {}, ctx())) as {
    projectId: string
    content: unknown
  }
  expect(createContentOfSaveFile).toHaveBeenCalledTimes(1)
  expect(createContentOfSaveFile).toHaveBeenCalledWith(
    project.address.projectId,
  )
  expect(result.projectId).toBe(project.address.projectId)
  expect(result.content).toEqual(content)
})

test('exportState 返回深拷贝:改返回值不影响 studio 持有的存档对象', async () => {
  const {registry, content} = makeScene()
  const result = (await registry.execute('project.exportState', {}, ctx())) as {
    projectId: string
    content: ReturnType<typeof fakeSaveFileContent>
  }
  expect(result.content).not.toBe(content)
  expect(result.content.sheetsById).not.toBe(content.sheetsById)
  // 篡改返回值的深层节点,源对象必须原样
  result.content.sheetsById.Scene.staticOverrides.byObject['Y Bot'].position.x =
    999
  result.content.revisionHistory.push('mutated')
  expect(
    content.sheetsById.Scene.staticOverrides.byObject['Y Bot'].position.x,
  ).toBe(1)
  expect(content.revisionHistory).toEqual(['r1'])
})

test('exportState 结果只含 projectId/content,不夹带会话或任务状态', async () => {
  const {registry, content} = makeScene()
  const result = (await registry.execute('project.exportState', {}, ctx())) as
    | Record<string, unknown>
    | undefined
  expect(result).toBeDefined()
  // 顶层结构恰好两个键:不出现 Library 条目、activeCamera、PIP、任务状态
  expect(Object.keys(result!).sort()).toEqual(['content', 'projectId'])
  // 存档内容就是 createContentOfSaveFile 的深拷贝,不多不少
  expect(result!.content).toEqual(content)
  const serialized = JSON.stringify(result)
  for (const sessionKey of [
    'activeCamera',
    'pipVisible',
    'shotView',
    'library',
    'jobs',
    'placing',
    'editingPath',
  ]) {
    expect(serialized.includes(sessionKey)).toBe(false)
  }
})

test('Studio 未初始化时 exportState 返回 API_NOT_READY', async () => {
  const {registry} = makeScene({withStudio: false})
  await expect(
    registry.execute('project.exportState', {}, ctx()),
  ).rejects.toMatchObject({code: 'API_NOT_READY'})
})

test('会话销毁后 exportState 返回 API_DISPOSED', async () => {
  const {registry, runtime} = makeScene()
  runtime.dispose()
  await expect(
    registry.execute('project.exportState', {}, ctx()),
  ).rejects.toMatchObject({code: 'API_DISPOSED'})
})

test('describe() 中 project.exportState 标记 query/project、undoable:none', () => {
  const {registry} = makeScene()
  const command = registry
    .describe()
    .commands.find((c) => c.name === 'project.exportState')
  expect(command).toBeDefined()
  expect(command).toMatchObject({
    kind: 'query',
    stateDomain: 'project',
    undoable: 'none',
  })
})
