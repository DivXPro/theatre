/**
 * 契约覆盖测试(2026-10-19,Task 16,spec §9):
 * registerAllAgentCommands 的注册面与 EXPECTED_AGENT_COMMANDS 完全一致
 * ——缺少与多出都失败,失败输出点名具体命令,不许通过删预期命令变绿。
 *
 * 元数据完备性(与命令注册同一份 describe() 快照):
 * - 每个命令:非空 input/output schema;
 * - 每个项目 mutation(stateDomain:project 且 kind:mutation):completion、
 *   非空 errorCodes,且 acceptsExpectedRevision 为 true(spec 8.7);
 * - 每个 job(kind:job):cancelable、completion、非空 jobResultSchema。
 *
 * 注册路径不触达 runtime(命令闭包到 execute 才用),用空对象占位即可。
 */
import {AgentCommandRegistry} from './registry'
import type {RegistryDescription} from './registry'
import {registerAllAgentCommands} from './registerCommands'
import {EXPECTED_AGENT_COMMANDS} from './expectedCommands'

function describeAll(): RegistryDescription {
  const registry = new AgentCommandRegistry()
  registerAllAgentCommands(registry, {} as never)
  return registry.describe()
}

test('命令清单与 spec §9 完全一致:缺少与多出都失败', () => {
  const actual = describeAll().commands.map((command) => command.name)
  const expected = [...EXPECTED_AGENT_COMMANDS].sort()
  const missing = expected.filter((name) => !actual.includes(name))
  const extra = actual.filter(
    (name) => !expected.includes(name as (typeof expected)[number]),
  )
  // 先给点名清单(缺口定位),再给全量比对(顺序即 describe() 排序)
  expect({missing, extra}).toEqual({missing: [], extra: []})
  expect(actual).toEqual(expected)
  expect(new Set(actual).size).toBe(actual.length)
})

test('每个命令都有非空 input/output schema', () => {
  const problems: string[] = []
  for (const command of describeAll().commands) {
    if (
      !command.inputSchema ||
      typeof command.inputSchema !== 'object' ||
      Object.keys(command.inputSchema).length === 0
    ) {
      problems.push(`${command.name}: inputSchema 为空`)
    }
    if (
      !command.outputSchema ||
      typeof command.outputSchema !== 'object' ||
      Object.keys(command.outputSchema).length === 0
    ) {
      problems.push(`${command.name}: outputSchema 为空`)
    }
  }
  expect(problems).toEqual([])
})

test('项目 mutation 元数据完备:undoable/completion/errorCodes/acceptsExpectedRevision', () => {
  const problems: string[] = []
  for (const command of describeAll().commands) {
    if (command.kind !== 'mutation' || command.stateDomain !== 'project') {
      continue
    }
    if (command.undoable !== 'single-step' && command.undoable !== 'none') {
      problems.push(`${command.name}: undoable 未声明`)
    }
    if (!command.completion) {
      problems.push(`${command.name}: 项目 mutation 缺 completion`)
    }
    if (!command.errorCodes || command.errorCodes.length === 0) {
      problems.push(`${command.name}: 项目 mutation 缺 errorCodes`)
    }
    if (command.acceptsExpectedRevision !== true) {
      problems.push(`${command.name}: 项目 mutation 应接受 expectedRevision`)
    }
  }
  expect(problems).toEqual([])
})

test('job 元数据完备:cancelable/completion/jobResultSchema', () => {
  const problems: string[] = []
  for (const command of describeAll().commands) {
    if (command.kind !== 'job') continue
    if (typeof command.cancelable !== 'boolean') {
      problems.push(`${command.name}: job 缺 cancelable 声明`)
    }
    if (!command.completion) {
      problems.push(`${command.name}: job 缺 completion`)
    }
    if (
      !command.jobResultSchema ||
      typeof command.jobResultSchema !== 'object' ||
      Object.keys(command.jobResultSchema).length === 0
    ) {
      problems.push(`${command.name}: job 缺非空 jobResultSchema`)
    }
  }
  expect(problems).toEqual([])
})
