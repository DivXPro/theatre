/**
 * 写帧通道分支(spec §7.2/§7.3):writePoseKeyframe 有轨道时只 scrub set;
 * 无轨道时先 transaction(sequenceProp)建轨再 scrub set(两步事务为已知
 * 限制,spec §2.4)。setPoseValue 永不建轨。轨道读取依赖 theatre 内部
 * 指针结构,单测用注入的根解析器;真实对象行为进冒烟清单。
 * jest-esbuild 不提升 jest.mock:doMock + resetModules + 运行时 require。
 * (2026-10-01 属性行化:poseCustom 备份机制退役,写入只动 pose 本身。)
 */
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

function setup() {
  jest.resetModules()
  const calls = {sequenceProp: 0, set: 0, commit: 0, transaction: 0}
  const setCalls: Array<{prop: string; value: $IntentionalAny}> = []
  const fakeStudio = {
    transaction: jest.fn((fn: $IntentionalAny) => {
      calls.transaction++
      fn({sequenceProp: () => calls.sequenceProp++})
    }),
    scrub: jest.fn(() => ({
      capture: (fn: $IntentionalAny) =>
        fn({
          set: (ptr: $IntentionalAny, value: $IntentionalAny) => {
            calls.set++
            setCalls.push({prop: ptr.__name, value})
          },
        }),
      commit: () => calls.commit++,
    })),
  }
  jest.doMock('@dreamerbird/core', () => ({getStudioSync: () => fakeStudio}))
  const mod =
    require('./poseTrack') as $IntentionalAny as typeof import('./poseTrack') & {
      __setPointerRootResolverForTest: (
        fn: (() => $IntentionalAny) | null,
      ) => void
    }
  const rootWithTrack = (trackId: string | undefined) => ({
    template: {
      getMapOfValidSequenceTracks_forStudio: () => ({
        getValue: () => (trackId ? {pose: trackId} : {}),
      }),
    },
  })
  const sheetObject = {
    address: {
      projectId: 'p',
      sheetId: 's',
      sheetInstanceId: 'i',
      objectKey: 'o',
    },
    props: {pose: {__name: 'pose'}},
  } as $IntentionalAny
  return {calls, setCalls, mod, sheetObject, rootWithTrack}
}

afterEach(() => jest.dontMock('@dreamerbird/core'))

describe('writePoseKeyframe', () => {
  test('无轨道:transaction 建轨 + scrub 写首帧(两步)', () => {
    const {calls, setCalls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    mod.writePoseKeyframe(sheetObject, '{"kind":"custom","bones":{}}')
    expect(calls.transaction).toBe(1)
    expect(calls.sequenceProp).toBe(1)
    expect(setCalls).toEqual([
      {prop: 'pose', value: '{"kind":"custom","bones":{}}'},
    ])
    expect(calls.commit).toBe(1)
    mod.__setPointerRootResolverForTest(null)
  })

  test('有轨道:只 scrub set(帧上覆盖/帧间新建由 theatre 按 position 决定)', () => {
    const {calls, setCalls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack('track-1'))
    mod.writePoseKeyframe(sheetObject, '{"kind":"custom","bones":{}}')
    expect(calls.transaction).toBe(0)
    expect(setCalls).toEqual([
      {prop: 'pose', value: '{"kind":"custom","bones":{}}'},
    ])
    expect(calls.commit).toBe(1)
    mod.__setPointerRootResolverForTest(null)
  })

  test('getPoseTrackId / getPoseKeyframeCount 经根解析器读取', () => {
    const {mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack('track-1'))
    expect(mod.getPoseTrackId(sheetObject)).toBe('track-1')
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    expect(mod.getPoseTrackId(sheetObject)).toBe(undefined)
    mod.__setPointerRootResolverForTest(null)
  })
})

describe('setPoseValue', () => {
  test('永不建轨:无轨道也只 scrub set', () => {
    const {calls, setCalls, mod, sheetObject, rootWithTrack} = setup()
    mod.__setPointerRootResolverForTest(() => rootWithTrack(undefined))
    mod.setPoseValue(sheetObject, '{"kind":"lib","id":"x"}')
    expect(calls.transaction).toBe(0)
    expect(setCalls).toEqual([{prop: 'pose', value: '{"kind":"lib","id":"x"}'}])
    mod.__setPointerRootResolverForTest(null)
  })
})
