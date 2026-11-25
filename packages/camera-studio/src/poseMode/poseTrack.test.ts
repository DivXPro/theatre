/**
 * setPoseValue 保留旧入口的 track-aware scrub 写入,不主动建轨。
 * writePoseKeyframe 的建轨和撤销契约由 poseTrack.realStudio.test.ts 验证。
 * jest-esbuild 不提升 jest.mock:doMock + resetModules + 运行时 require。
 * (2026-10-01 属性行化:poseCustom 备份机制退役,写入只动 pose 本身。)
 */
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

function setup() {
  jest.resetModules()
  const calls = {set: 0, commit: 0, transaction: 0}
  const setCalls: Array<{prop: string; value: $IntentionalAny}> = []
  const fakeStudio = {
    transaction: jest.fn(() => {
      calls.transaction++
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
  jest.doMock('@dreamerbird/studio/camera-studio', () => ({
    getStudio: () => undefined,
  }))
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

afterEach(() => {
  jest.dontMock('@dreamerbird/core')
  jest.dontMock('@dreamerbird/studio/camera-studio')
})

describe('getPoseTrackId', () => {
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
