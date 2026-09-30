import type {$IntentionalAny, Schema} from '../types'
import SaazBack from './SaazBack'
import {BackMemoryAdapter} from './BackMemoryAdapter'

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

describe('SaazBack replay guard', () => {
  test('an update that fails to replay is skipped + acknowledged; later updates in the same batch still apply', async () => {
    // 客户端本地存着旧开发版本留下的坏 update(回放即抛)时,旧实现会让
    // applyUpdates 整批抛错:同批后续好更新永远落不了库,坏更新永远得不到
    // 确认、卡在客户端队列里每次同步都重试(2026-09-25 事故链条的一环)。
    // 修复后:坏更新跳过 + 确认(客户端据此清出队列),好更新正常落库。
    const back = new SaazBack({
      dbName: 'd',
      storageAdapter: new BackMemoryAdapter(),
      schema,
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await back.applyUpdates({
        backendClock: null,
        peerId: 'p1',
        updates: [
          {
            peerId: 'p1',
            peerClock: 1,
            invokations: [['removedEditor', {to: 1}]],
            generatorRecordings: {},
            draftOps: [],
          },
          {
            peerId: 'p1',
            peerClock: 2,
            invokations: [['setCount', {to: 7}]],
            generatorRecordings: {},
            draftOps: [],
          },
        ],
      })
      if (!res.ok) throw new Error('expected ok:true, got a rejection')
      // 好更新落库
      expect(res.hasUpdates).toBe(true)
      expect((res as $IntentionalAny).snapshot.value.op.opCount).toBe(7)
      // 坏更新也被确认:客户端会把它清出队列,不会每次同步都重试
      expect(res.lastIncorporatedPeerClock).toBe(2)
      // 跳过必须告警,而不是静默丢数据
      expect(
        warnSpy.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].includes('skipping an update'),
        ),
      ).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
