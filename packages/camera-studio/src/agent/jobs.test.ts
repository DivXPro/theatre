import {AgentJobManager} from './jobs'
import {AgentApiError} from './errors'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

test('start publishes a running snapshot and update reaches subscribers', async () => {
  const manager = new AgentJobManager()
  const received: unknown[] = []
  const unsubscribe = manager.subscribe((snapshot) => {
    received.push(snapshot)
  })
  const gate = deferred<string>()

  const handle = manager.start({
    kind: 'test.job',
    cancelable: true,
    execute: async ({update}) => {
      await Promise.resolve()
      update({progress: 0.5, phase: 'committed'})
      return gate.promise
    },
  })

  const immediate = manager.get(handle.jobId)
  expect(['pending', 'running']).toContain(immediate.state)
  expect(immediate.phase).toBe('accepted')
  expect(immediate.cancelable).toBe(true)
  expect(immediate.jobId).toBe(handle.jobId)
  expect(Object.isFrozen(immediate)).toBe(true)

  expect(received[0]).toMatchObject({state: 'running', progress: 0})
  // execute 体内的 update 在微任务后到达
  for (let i = 0; i < 10 && received.length < 2; i += 1) {
    await Promise.resolve()
  }
  expect(received.length).toBeGreaterThanOrEqual(2)
  expect(received[1]).toMatchObject({progress: 0.5, phase: 'committed'})
  expect(received[1]).not.toBe(received[0])

  gate.resolve('ok')
  const final = await handle.done
  expect(final).toMatchObject({
    state: 'succeeded',
    progress: 1,
    result: 'ok',
  })
  expect(manager.get(handle.jobId)).toMatchObject({
    state: 'succeeded',
    result: 'ok',
  })
  unsubscribe()
})

test('snapshots are immutable copies that never mutate in place', async () => {
  const manager = new AgentJobManager()
  const seen: Array<{progress: number}> = []
  manager.subscribe((snapshot) => {
    seen.push({progress: snapshot.progress})
  })
  const handle = manager.start({
    kind: 'test.immutable',
    cancelable: false,
    execute: async ({update}) => {
      update({progress: 0.5})
      return 'done'
    },
  })
  await handle.done
  expect(seen.map((s) => s.progress)).toEqual([0, 0.5, 1])
  const final = manager.get(handle.jobId)
  expect(Object.isFrozen(final)).toBe(true)
})

test('cancel aborts the signal and maps the job to cancelled', async () => {
  const manager = new AgentJobManager()
  const gate = deferred<string>()
  let seenSignal: AbortSignal | undefined
  const handle = manager.start({
    kind: 'test.cancelable',
    cancelable: true,
    execute: ({signal}) => {
      seenSignal = signal
      return gate.promise
    },
  })

  manager.cancel(handle.jobId)
  expect(seenSignal?.aborted).toBe(true)
  expect(manager.get(handle.jobId)).toMatchObject({state: 'cancelled'})

  // 取消后 execute 晚到的 resolve 不得覆盖终态
  gate.resolve('late')
  const final = await handle.done
  expect(final).toMatchObject({state: 'cancelled'})
})

test('cancel on a non-cancelable job throws JOB_NOT_CANCELABLE', () => {
  const manager = new AgentJobManager()
  const handle = manager.start({
    kind: 'test.locked',
    cancelable: false,
    execute: () => new Promise(() => {}),
  })
  try {
    manager.cancel(handle.jobId)
    throw new Error('Expected JOB_NOT_CANCELABLE')
  } catch (error) {
    expect(error).toBeInstanceOf(AgentApiError)
    expect(error).toMatchObject({code: 'JOB_NOT_CANCELABLE'})
  }
})

test('cancel or get on an unknown id throws JOB_NOT_FOUND', () => {
  const manager = new AgentJobManager()
  for (const fn of [
    () => manager.cancel('job-missing'),
    () => manager.get('job-missing'),
  ]) {
    try {
      fn()
      throw new Error('Expected JOB_NOT_FOUND')
    } catch (error) {
      expect(error).toMatchObject({code: 'JOB_NOT_FOUND'})
    }
  }
})

test('cancel on a finished job throws INVALID_STATE', async () => {
  const manager = new AgentJobManager()
  const handle = manager.start({
    kind: 'test.done',
    cancelable: true,
    execute: async () => 'ok',
  })
  await handle.done
  try {
    manager.cancel(handle.jobId)
    throw new Error('Expected INVALID_STATE')
  } catch (error) {
    expect(error).toMatchObject({code: 'INVALID_STATE'})
  }
})

test('failure maps to a failed snapshot with a normalized error', async () => {
  const manager = new AgentJobManager()
  const handle = manager.start({
    kind: 'test.fail',
    cancelable: false,
    execute: async () => {
      throw new Error('boom')
    },
  })
  const final = await handle.done
  expect(final.state).toBe('failed')
  expect(final.result).toBeUndefined()
  expect(final.error).toMatchObject({
    code: 'INTERNAL_ERROR',
    message: 'boom',
    retryable: false,
  })
  expect(manager.get(handle.jobId)).toMatchObject({state: 'failed'})
})

test('structured AgentApiError failures keep their code in the snapshot', async () => {
  const manager = new AgentJobManager()
  const handle = manager.start({
    kind: 'test.domain-fail',
    cancelable: false,
    execute: async () => {
      throw new AgentApiError('RESOURCE_LOAD_FAILED', '模型加载失败', {
        retryable: true,
        details: {assetId: 'a1'},
      })
    },
  })
  const final = await handle.done
  expect(final).toMatchObject({
    state: 'failed',
    error: {
      code: 'RESOURCE_LOAD_FAILED',
      retryable: true,
      details: {assetId: 'a1'},
    },
  })
})

test('falls back to counter-based ids when crypto.randomUUID is unavailable', async () => {
  const globals = globalThis as {crypto?: {randomUUID?: () => string}}
  const original = globals.crypto?.randomUUID
  if (globals.crypto) {
    globals.crypto.randomUUID = undefined
  }
  try {
    const manager = new AgentJobManager()
    const handle = manager.start({
      kind: 'test.fallback',
      cancelable: true,
      execute: async () => 'ok',
    })
    expect(handle.jobId).toMatch(/^job-\d+-\d+$/)
    await handle.done
  } finally {
    if (globals.crypto && original) {
      globals.crypto.randomUUID = original
    }
  }
})

test('unsubscribe stops notifications', async () => {
  const manager = new AgentJobManager()
  let calls = 0
  const unsubscribe = manager.subscribe(() => {
    calls += 1
  })
  const handle = manager.start({
    kind: 'test.unsub',
    cancelable: false,
    execute: async () => 'ok',
  })
  await handle.done
  expect(calls).toBeGreaterThan(0)
  const before = calls
  unsubscribe()
  manager.start({
    kind: 'test.unsub2',
    cancelable: false,
    execute: async () => 'ok',
  })
  await Promise.resolve()
  expect(calls).toBe(before)
})

test('a throwing subscriber neither corrupts job state nor blocks broadcast', async () => {
  const manager = new AgentJobManager()
  const received: string[] = []
  manager.subscribe(() => {
    throw new Error('subscriber boom')
  })
  manager.subscribe((snapshot) => {
    received.push(`${snapshot.state}:${snapshot.progress}`)
  })
  const handle = manager.start({
    kind: 'test.throwing-subscriber',
    cancelable: true,
    execute: async ({update}) => {
      update({progress: 0.5})
      return 'ok'
    },
  })
  // 订阅者抛错不得被 start 的 catch 误判为任务失败
  const final = await handle.done
  expect(final).toMatchObject({state: 'succeeded', progress: 1, result: 'ok'})
  // 抛错订阅者之后的订阅者仍收到每一次广播
  expect(received).toEqual(['running:0', 'running:0.5', 'succeeded:1'])

  // cancel 路径同样隔离订阅者异常
  const cancelable = manager.start({
    kind: 'test.throwing-subscriber-cancel',
    cancelable: true,
    execute: () => new Promise(() => {}),
  })
  expect(() => manager.cancel(cancelable.jobId)).not.toThrow()
  expect(manager.get(cancelable.jobId)).toMatchObject({state: 'cancelled'})
})
