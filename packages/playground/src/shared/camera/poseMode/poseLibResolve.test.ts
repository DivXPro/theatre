/**
 * 库姿势解析缓存(spec §5):插值器在求值热路径必须同步读,库条目在
 * IndexedDB 是异步——同步缓存 + 异步预取 + invalidate 重求值。
 * 缓存未命中:回 null(调用方回绑定/阶跃),每个 id 只告警一次。
 *
 * jest-esbuild 不提升 jest.mock,静态 import 会在 doMock 登记前先
 * require 被测模块(库门面被真模块占住,异步失败被吞掉、测试假绿)——
 * 故用 doMock 先行登记 + resetModules + 运行时 require(仓库既定
 * 模式,见 App.hostFlows.test.tsx)。
 */
import type {PoseBones} from './poseOverride'

const bones: PoseBones = {Hips: {rotation: [0, 0, 0, 1], position: [0, 1, 0]}}

const getEntryMock = jest.fn(async (id: string) =>
  id === 'inLib' ? {kind: 'pose', id, rig: 'mixamo', bones} : undefined,
)

jest.doMock('../assetLibrary/library', () => ({
  getLibrary: () => ({backend: {getEntry: getEntryMock}}),
}))

let resolveLibPoseBones: typeof import('./poseLibResolve').resolveLibPoseBones
let resolvePoseBones: typeof import('./poseLibResolve').resolvePoseBones
let prefetchLibPoses: typeof import('./poseLibResolve').prefetchLibPoses
let __primeLibPoseCache: typeof import('./poseLibResolve').__primeLibPoseCache
let __resetLibPoseCache: typeof import('./poseLibResolve').__resetLibPoseCache

beforeEach(() => {
  jest.resetModules()
  getEntryMock.mockClear()
  ;({
    resolveLibPoseBones,
    resolvePoseBones,
    prefetchLibPoses,
    __primeLibPoseCache,
    __resetLibPoseCache,
  } = require('./poseLibResolve') as typeof import('./poseLibResolve'))
  __resetLibPoseCache()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  ;(console.warn as jest.Mock).mockRestore()
})

test('未缓存回 null 且每 id 只告警一次;prime 后命中', () => {
  expect(resolveLibPoseBones('missing')).toBe(null)
  expect(resolveLibPoseBones('missing')).toBe(null)
  expect(console.warn).toHaveBeenCalledTimes(1)
  __primeLibPoseCache('missing', bones)
  expect(resolveLibPoseBones('missing')).toBe(bones)
})

test('prefetch 拉取缺失条目进缓存并回调 onReady;已缓存不重复拉', async () => {
  __primeLibPoseCache('inLib', bones)
  const onReady = jest.fn()
  await prefetchLibPoses(['inLib', 'absent'], onReady)
  expect(resolveLibPoseBones('inLib')).toBe(bones)
  expect(resolveLibPoseBones('absent')).toBe(null)
  expect(onReady).toHaveBeenCalledTimes(1)
  // 已缓存的 inLib 不重复拉;absent 拉过但后端无此条目,不入缓存
  expect(getEntryMock).toHaveBeenCalledTimes(1)
  expect(getEntryMock).toHaveBeenCalledWith('absent')
})

test('prefetch 未缓存的库 id 由后端填充进缓存', async () => {
  const onReady = jest.fn()
  await prefetchLibPoses(['inLib'], onReady)
  expect(resolveLibPoseBones('inLib')).toBe(bones)
  expect(onReady).toHaveBeenCalledTimes(1)
})

test('resolvePoseBones:null→null;custom→bones;lib→缓存或 null', () => {
  expect(resolvePoseBones(null)).toBe(null)
  expect(resolvePoseBones({kind: 'custom', bones})).toBe(bones)
  expect(resolvePoseBones({kind: 'lib', id: 'inLib'})).toBe(null) // 未预取
  __primeLibPoseCache('inLib', bones)
  expect(resolvePoseBones({kind: 'lib', id: 'inLib'})).toBe(bones)
})
