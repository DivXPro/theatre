import {createAgentRuntime} from './runtime'
import type {AgentRuntimeDeps, AgentSceneRuntimeHandlers} from './runtime'

/**
 * 本文件的绑定键是合成假键(a/b/c/d),不属于任何领域 handler;
 * 真实 handler 由各领域任务经 declaration merging 加入接口(Task 4 起),
 * 之后 Partial<AgentSceneRuntimeHandlers> 成为弱类型,对象字面量会触发
 * 多余属性检查 —— 故此处统一断言绕过(语义不变:仍验证合并/解绑行为)。
 */
const fakeHandlers = (
  handlers: Record<string, unknown>,
): Partial<AgentSceneRuntimeHandlers> =>
  handlers as Partial<AgentSceneRuntimeHandlers>

function expectErrorCode(fn: () => void, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({code})
    return
  }
  throw new Error(`Expected ${code}`)
}

function makeDeps(overrides: Partial<AgentRuntimeDeps> = {}): AgentRuntimeDeps {
  return {
    project: {ready: Promise.resolve()} as never,
    sheet: {} as never,
    library: {} as never,
    getStudio: () => ({}) as never,
    subscribeHistoric: () => () => {},
    ...overrides,
  }
}

test('tracks every historic change and rejects stale writes', () => {
  let notify: (() => void) | undefined
  const runtime = createAgentRuntime({
    project: {ready: Promise.resolve()} as never,
    sheet: {} as never,
    library: {} as never,
    getStudio: () => ({}) as never,
    subscribeHistoric: (listener) => {
      notify = listener
      return () => {
        notify = undefined
      }
    },
  })
  expect(runtime.revision).toBe(1)
  expect(() => runtime.assertRevision(1)).not.toThrow()
  notify?.()
  expect(runtime.revision).toBe(2)
  expectErrorCode(() => runtime.assertRevision(1), 'REVISION_CONFLICT')
  runtime.dispose()
  expectErrorCode(() => runtime.assertActive(), 'API_DISPOSED')
})

test('revision conflict details carry expected and actual revision', () => {
  let notify: (() => void) | undefined
  const runtime = createAgentRuntime(
    makeDeps({
      subscribeHistoric: (listener) => {
        notify = listener
        return () => {
          notify = undefined
        }
      },
    }),
  )
  notify?.()
  notify?.()
  expect(runtime.revision).toBe(3)
  try {
    runtime.assertRevision(1)
    throw new Error('Expected REVISION_CONFLICT')
  } catch (error) {
    expect(error).toMatchObject({
      code: 'REVISION_CONFLICT',
      details: {expectedRevision: 1, actualRevision: 3},
    })
  }
})

test('activate() supersedes the old generation', () => {
  const runtime = createAgentRuntime(makeDeps())
  expect(() => runtime.assertCurrent()).not.toThrow()
  const next = runtime.activate()
  expectErrorCode(() => runtime.assertCurrent(), 'API_DISPOSED')
  expect(() => next.assertCurrent()).not.toThrow()
  expect(() => next.assertActive()).not.toThrow()
  // 会话级 revision/jobs 在代次间共享
  expect(next.jobs).toBe(runtime.jobs)
  expectErrorCode(() => runtime.markReady(), 'API_DISPOSED')
})

test('stale generation fails revision checks before comparing', () => {
  let notify: (() => void) | undefined
  const runtime = createAgentRuntime(
    makeDeps({
      subscribeHistoric: (listener) => {
        notify = listener
        return () => {
          notify = undefined
        }
      },
    }),
  )
  const next = runtime.activate()
  notify?.()
  expect(next.revision).toBe(2)
  // 旧代次先撞代次检查,而不是报 revision 冲突
  expectErrorCode(() => runtime.assertRevision(2), 'API_DISPOSED')
  expect(() => next.assertRevision(2)).not.toThrow()
})

test('readiness resolves per generation and dispose rejects pending ready', async () => {
  const runtime = createAgentRuntime(makeDeps())
  let settled = false
  void runtime.ready.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  runtime.markReady()
  await runtime.ready

  const next = runtime.activate()
  const nextReady = next.ready
  const rejected = expect(nextReady).rejects.toMatchObject({
    code: 'API_DISPOSED',
  })
  await Promise.resolve()
  next.dispose()
  await rejected
  expectErrorCode(() => next.assertActive(), 'API_DISPOSED')
  expectErrorCode(() => runtime.assertActive(), 'API_DISPOSED')
  expectErrorCode(() => runtime.activate(), 'API_DISPOSED')
})

test('bindHandlers merges handlers and unbind removes only its own keys', () => {
  const runtime = createAgentRuntime(makeDeps())
  const unbindA = runtime.bindHandlers(fakeHandlers({a: 1}))
  const unbindB = runtime.bindHandlers(fakeHandlers({b: 2}))
  expect(runtime.handlers).toEqual({a: 1, b: 2})
  unbindA()
  expect(runtime.handlers).toEqual({b: 2})

  // 代次被替换后:在存活期创建的解绑函数调用静默失效,
  // 而继续绑定被明确拒绝(与 markReady/assertCurrent 一致)
  const next = runtime.activate()
  expect(() => unbindB()).not.toThrow()
  expect(runtime.handlers).toEqual({b: 2})
  expect(next.handlers).toEqual({})
  expectErrorCode(
    () => runtime.bindHandlers(fakeHandlers({c: 3})),
    'API_DISPOSED',
  )
  // 会话 dispose 后同样拒绝绑定
  next.dispose()
  expectErrorCode(() => next.bindHandlers(fakeHandlers({d: 4})), 'API_DISPOSED')
})
