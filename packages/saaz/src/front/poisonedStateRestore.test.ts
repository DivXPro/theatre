import type {$IntentionalAny, Schema} from '../types'
import {SaazFront} from './SaazFront'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'
import SaazBack from '../back/SaazBack'
import {BackMemoryAdapter} from '../back/BackMemoryAdapter'

jest.setTimeout(5000)

type OpShape = {$schemaVersion: number; opCount: number}
type Editors = {setCount(state: OpShape, g: {}, opts: {to: number}): void}

const editors: Editors = {
  setCount(state, _g, opts) {
    state.opCount = opts.to
  },
}

const schema: Schema<OpShape, Editors, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors,
  generators: {},
  cellShape: {},
}

function freshBack() {
  return new SaazBack({
    dbName: 'd',
    storageAdapter: new BackMemoryAdapter(),
    schema,
  })
}

async function seedStorageWithSyncedState() {
  const frontAdapter = new FrontMemoryAdapter()
  const front = new SaazFront({
    schema,
    dbName: 'd',
    storageAdapter: frontAdapter,
    backend: freshBack(),
    peerId: 'oldPeer',
  })
  await front.ready
  front.tx((e) => e.setCount({to: 42}), undefined)
  await front.waitForBackendSync()
  await front.waitForStorageSync()
  front.teardown()
  return frontAdapter.export()
}

/** 把存档里所有 session 的 snapshot 替换为指定值(模拟旧开发版本的形状漂移) */
function poisonSnapshots(stored: unknown, poison: unknown): unknown {
  // export() 返回 immer 冻结的状态,必须先深拷贝再改
  const s = JSON.parse(JSON.stringify(stored)) as $IntentionalAny
  for (const session of Object.values<$IntentionalAny>(s.sessions)) {
    if (session?.keyval?.sessionState) {
      session.keyval.sessionState = {
        ...session.keyval.sessionState,
        snapshot: poison,
      }
    }
  }
  return s
}

/**
 * 把存档里所有持久化的 optimistic update 的 invokations 替换为指定值,
 * 并把 lastIncorporatedPeerClock 复位为 -1,让新 front 在接管 closed session
 * 时真实地重放这些 update(否则会被 peerClock 过滤掉)。
 * 模拟:旧开发版本崩溃时留下了从未推到 backend 的 update。
 */
function poisonStoredUpdates(stored: unknown, invokations: unknown): unknown {
  const s = JSON.parse(JSON.stringify(stored)) as $IntentionalAny
  for (const session of Object.values<$IntentionalAny>(s.sessions)) {
    if (session?.keyval?.sessionState) {
      session.keyval.sessionState = {
        ...session.keyval.sessionState,
        lastIncorporatedPeerClock: -1,
      }
    }
    const list = session?.lists?.optimisticUpdates
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry?.transaction) {
          entry.transaction = {...entry.transaction, invokations}
        }
      }
    }
  }
  return s
}

// 每个测试都必须 teardown(即使是断言失败):navigator.locks mock 是全局的,
// 不释放会让后续测试静默跳过 closed session 接管,毒化根本不会被加载。
describe('restoring from incompatible persisted state', () => {
  test('old-shape snapshot does not kill init; front stays usable', async () => {
    const stored = poisonSnapshots(await seedStorageWithSyncedState(), {
      sheetsById: {},
    })
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(stored),
      backend: freshBack(),
    })
    try {
      await front.ready
      // 回退到空状态后,读写都必须工作
      expect(() => front.state).not.toThrow()
      front.tx((e) => e.setCount({to: 7}), undefined)
      expect(front.state.op.opCount).toBe(7)
    } finally {
      front.teardown()
    }
  })

  test('undefined snapshot does not kill init; front stays usable', async () => {
    const stored = poisonSnapshots(
      await seedStorageWithSyncedState(),
      undefined,
    )
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(stored),
      backend: freshBack(),
    })
    try {
      await front.ready
      expect(() => front.state).not.toThrow()
      front.tx((e) => e.setCount({to: 3}), undefined)
      expect(front.state.op.opCount).toBe(3)
    } finally {
      front.teardown()
    }
  })

  test('old-format (raw) snapshot cell falls back to empty; front stays usable', async () => {
    // 旧开发版本把 cell 存成未包装的 raw 对象;op 部分形状正常
    const stored = poisonSnapshots(await seedStorageWithSyncedState(), {
      op: {$schemaVersion: 1, opCount: 42},
      cell: {ahistoric: {foo: 1}, historic: {}, ephemeral: {}},
    })
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(stored),
      backend: freshBack(),
    })
    try {
      await front.ready
      expect(() => front.state).not.toThrow()
      // cell 已回退为空:读写 cell draft 不会抛 "not an ahistoric cell"
      front.tx(undefined, (cellDraft) => {
        void (cellDraft as $IntentionalAny).ahistoric
        ;(cellDraft as $IntentionalAny).foo = 'bar'
      })
      front.tx((e) => e.setCount({to: 9}), undefined)
      expect(front.state.op.opCount).toBe(9)
    } finally {
      front.teardown()
    }
  })

  test('stored update with unknown editor is skipped; front stays usable', async () => {
    const stored = poisonStoredUpdates(await seedStorageWithSyncedState(), [
      ['removedEditor', {to: 1}],
    ])
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const front = new SaazFront({
      schema,
      dbName: 'd',
      storageAdapter: new FrontMemoryAdapter(stored),
      backend: freshBack(),
    })
    try {
      await front.ready
      // 状态来自已同步的 snapshot(42),坏 update 不参与
      expect(front.state.op.opCount).toBe(42)
      // 坏 update 被跳过时必须告警,而不是静默丢数据
      expect(
        warnSpy.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].includes('skipping a persisted update'),
        ),
      ).toBe(true)
      front.tx((e) => e.setCount({to: 5}), undefined)
      expect(front.state.op.opCount).toBe(5)
    } finally {
      front.teardown()
      warnSpy.mockRestore()
    }
  })
})
