import {BackMemoryAdapter} from './back/BackMemoryAdapter'
import SaazBack from './back/SaazBack'
import {FrontMemoryAdapter} from './front/FrontMemoryAdapter'
import {SaazFront} from './front/SaazFront'
import type {Root} from './rogue'
import {change, compare, fromOps, jsonFromCell} from './rogue'
import type {Ops} from './rogue'
import type {Schema} from './types'

const ahistoricSnapshot: Root = {
  $type: ['map', 'base'],
  $branches: {
    base: {
      $mapProps: {
        foo: {
          $type: ['map', 'base'],
          $branches: {
            base: {
              $boxedValue:
                'some value here, but this will be ignored, because this is an obj register.',
              $mapProps: {
                bar: {
                  $type: ['boxed', 'base'],
                  $branches: {
                    base: {
                      $boxedValue:
                        'some value here. this is an lww register, and it can contain any json value.',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

describe(`Rogue`, () => {
  test('setting a non-existing prop', () => {
    const [rep, ops] = change({}, (draft) => {
      expect(draft.a).toBe(undefined)
      draft.a = 1
      expect(draft.a).toBe(1)
    })
    expect(jsonFromCell(rep)).toEqual({a: 1})

    expect([rep, ops]).toMatchSnapshot()
    const [rep2] = fromOps({}, ops)
    expect(rep2).toEqual(rep)
  })
  test('overriding an existing prop with the same value', () => {
    const [rep1] = change({}, (draft) => {
      draft.a = 1
    })
    const [rep2, ops] = change(rep1, (draft) => {
      expect(draft.a).toBe(1)
      draft.a = 1
      expect(draft.a).toBe(1)
    })
    expect(rep1).toBe(rep2)
    expect(ops).toEqual([])
  })
  test('新增深层子树的 backwardOps 带删除型逆操作,undo 可回', () => {
    const [rep1] = change({}, (draft) => {
      draft.byId = {obj1: {x: 1}}
    })
    const [rep2, , backwardOps] = change(rep1, (draft) => {
      draft.byId.obj2 = {y: 2}
    })
    expect(backwardOps.length).toBeGreaterThan(0)
    const [back] = fromOps(rep2, backwardOps)
    expect(jsonFromCell(back)).toEqual(jsonFromCell(rep1))
  })
  test('往空 map 写入首个 key:backwardOps 必须带删除型逆操作(撤销栈漏登根因)', () => {
    // 空 map 的 cell 没有指向分支($branches 为 {})——真实数据里 sequenceProp
    // 建轨产生的 keyframes.byId 就是这样。compare(新,旧) 算 backwardOps 时,
    // 旧态空 map 落在 after 侧:afterBranch 为 undefined,compareCell 的
    // `if (!afterBranch) return` 提前返回,「before 独有 key 补 deleted 逆操作」
    // 的循环被跳过 → backwardOps 空 → 事务不进撤销栈。
    // (2026-09-30 浏览器实测:首次摆姿势的关键帧提交不可撤销,根因即此)
    const [rep1] = change({}, (draft) => {
      draft.a = {}
    })
    // 前提:a 确实是「无指向分支」的空 map($branches 缺失或为空),否则测的不是目标场景
    const aCell = (rep1 as any).$branches.base.$mapProps.a
    expect(aCell.$type).toEqual(['map', 'base'])
    expect(Object.keys(aCell.$branches ?? {})).toHaveLength(0)

    const [rep2, , backwardOps] = change(rep1, (draft) => {
      draft.a.b = 1
    })
    expect(jsonFromCell(rep2)).toEqual({a: {b: 1}})
    // backwardOps 非空,且 undo 后 b 消失、回到 rep1 的快照
    expect(backwardOps.length).toBeGreaterThan(0)
    const [back] = fromOps(rep2, backwardOps)
    expect(jsonFromCell(back)).toEqual(jsonFromCell(rep1))
  })
  test('从 map 删掉最后一个 key:forwardOps 必须带删除操作(对称方向)', () => {
    // 对称场景:删除最后一个 key 后 after 侧变空 map(无指向分支),
    // 同一处提前返回会把 forwardOps 里的 deleted 操作也吞掉
    const [rep1] = change({}, (draft) => {
      draft.a = {b: 1}
    })
    const [rep2, ops] = change(rep1, (draft) => {
      delete draft.a.b
    })
    expect(jsonFromCell(rep2)).toEqual({a: {}})
    expect(ops.length).toBeGreaterThan(0)
    // 重放 ops 必须能从 rep1 得到 rep2
    const [replayed] = fromOps(rep1, ops)
    expect(jsonFromCell(replayed)).toEqual(jsonFromCell(rep2))
  })
  test('已知边界:双分支 cell 上,非 $type 指向分支的改动不进 ops', () => {
    // 节点标 ['map','ahistoric'],ahistoric 分支有旧内容;新态新增 base 分支
    // (ahistoric 分支同引用,模拟 immer 未碰它)。
    // compare 只比 $type[1] 指向的那一个分支,新分支的出现不进 ops。
    // 真实写入路径不会产生这种错位(traps.set 永远写 $type[1] 指向的分支),
    // 错位只可能来自多端合并/重放;若未来要支持,compareCell 需改为按
    // before/after 分支并集逐个比较。本测试钉住现状作为边界文档。
    const ahistoricBranch = {
      $mapProps: {
        ui: {$type: ['boxed', 'base'], $branches: {base: {$boxedValue: 1}}},
      },
    }
    const oldCell: any = {
      $type: ['map', 'ahistoric'],
      $branches: {ahistoric: ahistoricBranch},
    }
    const newCell: any = {
      $type: ['map', 'ahistoric'],
      $branches: {
        ahistoric: ahistoricBranch,
        base: {
          $mapProps: {
            pose: {
              $type: ['boxed', 'base'],
              $branches: {base: {$boxedValue: 2}},
            },
          },
        },
      },
    }
    expect(compare(oldCell, newCell)).toEqual([])
    expect(compare(newCell, oldCell)).toEqual([])
  })
  test('软删节点上重建子树的 backwardOps 带删除型逆操作,undo 可回', () => {
    const [rep1] = change({}, (draft) => {
      draft.a = {b: 1}
    })
    // 删除 a(saaz 软删:标 deleted 但子树保留)
    const [rep2] = change(rep1, (draft) => {
      delete draft.a
    })
    expect(jsonFromCell(rep2)).toEqual({})
    // 在(软删的)a 上重建子树
    const [rep3, , backwardOps] = change(rep2, (draft) => {
      draft.a = {c: 2}
    })
    expect(jsonFromCell(rep3)).toEqual({a: {c: 2}})
    expect(backwardOps.length).toBeGreaterThan(0)
    const [back] = fromOps(rep3, backwardOps)
    expect(jsonFromCell(back)).toEqual(jsonFromCell(rep2))
  })
  test('overriding an existing prop', () => {
    const [rep1] = change({}, (draft) => {
      draft.a = 1
    })
    const [rep2, ops] = change(rep1, (draft) => {
      expect(draft.a).toBe(1)
      draft.a = 2
      expect(draft.a).toBe(2)
    })
    expect(jsonFromCell(rep2)).toEqual({a: 2})
    expect(ops).toHaveLength(1)
    expect(ops).toMatchSnapshot()
    const [rep3] = fromOps(rep1, ops)
    expect(rep3).toEqual(rep2)
  })
  test('setting a non-existing prop to an object', () => {
    const [rep, ops] = change({}, (draft) => {
      expect(draft.a).toBe(undefined)
      draft.a = {b: 1}
      expect(draft.a).toEqual(draft.a)
      expect(draft.a).toEqual({b: 1})
    })
    expect(jsonFromCell(rep)).toEqual({a: {b: 1}})

    expect([rep, ops]).toMatchSnapshot()
    const [rep2] = fromOps({}, ops)
    expect(rep2).toEqual(rep)
  })

  test('setting an existing prop to an object', () => {
    const [rep] = change({}, (draft) => {
      draft.a = {b: 1}
    })
    expect(jsonFromCell(rep)).toEqual({a: {b: 1}})
    const [rep2, ops2] = change(rep, (draft) => {
      expect(draft.a).toEqual({b: 1})
      draft.a = {b: 2}
      expect(draft.a).toEqual({b: 2})
    })

    expect(jsonFromCell(rep2)).toEqual({a: {b: 2}})
    const [rep3] = fromOps(rep, ops2)
    expect(rep3).toEqual(rep2)
  })
  test('setting an existing prop from an object', () => {
    const [rep] = change({}, (draft) => {
      draft.a = {b: 1}
    })
    expect(jsonFromCell(rep)).toEqual({a: {b: 1}})
    const [rep2, ops2] = change(rep, (draft) => {
      expect(draft.a).toEqual({b: 1})
      draft.a = {c: 1}
      expect(draft.a).toEqual({c: 1})
    })

    expect(jsonFromCell(rep2)).toEqual({a: {c: 1}})
    const [rep3] = fromOps(rep, ops2)
    expect(rep3).toEqual(rep2)
  })

  test(`merging defaults`, () => {
    const [, ops1_1] = change({}, (draft) => {
      draft.a = {aStep: 1, foo: 'setBy1', obj: {objA: 'true'}}
    })
    const [, ops2_1] = change({}, (draft) => {
      draft.a = {bStep: 1, foo: 'setBy2', obj: {objB: 'true'}}
    })

    const merge1 = fromOps({}, [...ops2_1, ...ops1_1])[0]

    const _11 = jsonFromCell(merge1)
    expect(_11).toMatchSnapshot()
    // console.log(_11)
  })

  function scenario(
    name: string,
    steps: Record<
      string,
      (draft: any, lastSnapshot: any, lastOps: any[]) => void
    >,
  ) {
    describe(name, () => {
      type StepResult = {
        json: any
        ops: any[]
        backwardOps: any[]
        rep: any
        next?: StepResult
        prev?: StepResult
      }
      let last: StepResult = {
        json: {},
        backwardOps: [],
        ops: [],
        rep: {},
      }
      const byStep: Record<string, StepResult> = {}

      for (const [stepName, fn] of Object.entries(steps)) {
        test(stepName, () => {
          const prev: StepResult = {...last}
          const [rep, ops, backwardOps] = change(prev.rep, (draft) => {
            fn(draft, prev.json, prev.ops)
          })
          const stepResult: StepResult = {
            rep,
            ops,
            backwardOps,
            json: jsonFromCell(rep),
            prev,
          }
          last.next = stepResult
          last = stepResult
          byStep[stepName] = stepResult
        })
      }

      // i = 0 so that we skip the first step, which is the initial state
      for (let i = 1; i < Object.keys(steps).length; i++) {
        const prevStepName = Object.keys(steps)[i - 1]
        const stepName = Object.keys(steps)[i]
        test(`${prevStepName} => ${stepName}`, () => {
          const stepResult = byStep[stepName]
          const [rep] = fromOps(stepResult.prev!.rep, stepResult.ops)
          expect(rep).toEqual(stepResult.rep)
        })

        test(`${prevStepName} <= ${stepName}`, () => {
          const stepResult = byStep[stepName]
          const [rep] = fromOps(stepResult.rep, stepResult.backwardOps)
          const s = jsonFromCell(rep)
          // note that as opposed to the previous test, we're not comparing cells, we're
          // comparing snapshots. This is because the cells are not guaranteed to be the
          // same when undoing a change, but the snapshots are.
          expect(s).toEqual(stepResult.prev!.json)
        })
      }
    })
  }

  scenario('scenario 1', {
    step1: (draft) => {
      expect(draft.a).toBe(undefined)
      draft.a = 1
      expect(draft.a).toBe(1)
    },
    step2: (_, snapshot, ops) => {
      expect(snapshot).toEqual({a: 1})
    },
  })
  scenario('scenario 2', {
    step1: (draft) => {
      draft.a = {a1: {a11: 1}}
      expect(draft.a.a1).toEqual({a11: 1})
      draft.a.a1.a11 = 2
      expect(draft.a).toEqual({a1: {a11: 2}})
    },
    step2: (_, snapshot, ops) => {
      expect(snapshot).toEqual({a: {a1: {a11: 2}}})
    },
  })
  scenario('scenario 3', {
    step1: (draft) => {
      draft.a = {a1: {a11: 1}}
      expect(draft.a.a1).toEqual({a11: 1})
      draft.a = {b: 1}
      expect(draft.a).toEqual({b: 1})
    },
    step2: (draft, snapshot, ops) => {
      expect(draft.a).toEqual({b: 1})
      draft.a = 1
    },
    step3: (draft, snapshot) => {
      expect(snapshot).toEqual({a: 1})
    },
  })
  describe(`saaz integration`, () => {
    test(`test`, async () => {
      type State = {
        $schemaVersion: number
        count: number
      }

      const schema: Schema<State> = {
        version: 1,
        // migrateOp(state: $IntentionalAny) {},
        // migrateCell(s) {},
        generators: {},
        editors: {
          increaseBy(state: State, generators: {}, opts: {by: number}) {
            state.count += opts.by
          },
        },
        opShape: null as any as State,
        cellShape: null as any as {},
      }
      const backend = new SaazBack({
        schema,
        dbName: 'test',
        storageAdapter: new BackMemoryAdapter(),
      })
      const saaz = new SaazFront({
        schema,
        dbName: 'test',
        peerId: '1',
        storageAdapter: new FrontMemoryAdapter(),
        backend,
      })

      saaz.tx((editors) => {})

      saaz.teardown()
    })
  })
})

describe(`fromOps replay path guard`, () => {
  // 一条 update 回放失败被整体跳过后,后续 update 的 op 路径会穿过"本该由它
  // 创建"的缺失节点。此时 setDeep 会自动补出没有 $type 的裸 plain object 充当
  // mapProps 条目——状态被毒化,下一个读写 draft 的事务就抛
  // "mapProps[x] is not an ahistoric cell"(2026-09-25 用户实测崩溃)。
  // 回放必须拒绝这种 op,让调用方整体跳过该 update,而不是造出畸形状态。
  test('ChangeType crossing a missing intermediate node throws instead of auto-vivifying bare nodes', () => {
    const ops: Ops = [
      {
        type: 'ChangeType',
        path: [
          ['base', 'historic'],
          ['base', 'panels'],
        ],
        value: ['map', 'base'],
      },
    ]
    expect(() => fromOps({}, ops)).toThrow(/missing node/)
  })

  test('SetBoxedValue landing on a missing node throws (it would create a bare node)', () => {
    const ops: Ops = [
      {
        type: 'SetBoxedValue',
        path: [['base', 'historic']],
        branchName: 'base',
        value: 1,
      },
    ]
    expect(() => fromOps({}, ops)).toThrow(/missing node/)
  })

  test('ChangeType creating a node under an existing parent stays legal', () => {
    const ops: Ops = [
      {
        type: 'ChangeType',
        path: [['base', 'historic']],
        value: ['map', 'base'],
      },
    ]
    const [rep] = fromOps({}, ops)
    expect(jsonFromCell(rep)).toEqual({historic: {}})
  })

  test('ops building a subtree parent-first within one update stay legal', () => {
    const ops: Ops = [
      {
        type: 'ChangeType',
        path: [['base', 'historic']],
        value: ['map', 'base'],
      },
      {
        type: 'ChangeType',
        path: [
          ['base', 'historic'],
          ['base', 'panels'],
        ],
        value: ['map', 'base'],
      },
      {
        type: 'ChangeType',
        path: [
          ['base', 'historic'],
          ['base', 'panels'],
          ['base', 'count'],
        ],
        value: ['boxed', 'base'],
      },
      {
        type: 'SetBoxedValue',
        path: [
          ['base', 'historic'],
          ['base', 'panels'],
          ['base', 'count'],
        ],
        branchName: 'base',
        value: 3,
      },
    ]
    const [rep] = fromOps({}, ops)
    expect(jsonFromCell(rep)).toEqual({historic: {panels: {count: 3}}})
  })
})
