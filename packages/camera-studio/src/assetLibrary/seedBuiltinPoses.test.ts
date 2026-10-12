// packages/camera-studio/src/assetLibrary/seedBuiltinPoses.test.ts
import {seedBuiltinPosesInto} from './seedBuiltinPoses'
import {seedPoses} from './seedPoses'
import {seedPosesDpl} from './seedPosesDpl'
import {seedPosesQbx} from './seedPosesQbx'
import type {LibraryEntry, PoseEntry} from './types'

const TOTAL = seedPoses.length + seedPosesDpl.length + seedPosesQbx.length

function fakeLib(
  models: {name: string; rig: string}[][],
  existingPoses: PoseEntry[] = [],
  existingBlobIds: string[] = [],
) {
  const put: LibraryEntry[] = []
  const blobs: string[] = []
  let call = 0
  const lib = {
    listEntries: async (kind: string) => {
      if (kind === 'pose') return existingPoses
      expect(kind).toBe('model')
      return models[Math.min(call++, models.length - 1)]
    },
    putBlob: async (data: Blob) => {
      const id = 'blob-' + blobs.length
      blobs.push(id)
      return id
    },
    listBlobIds: async () => [...existingBlobIds, ...blobs],
    putEntry: async (e: LibraryEntry) => {
      put.push(e)
    },
  }
  return {lib, put, blobs}
}

// sleep 是空操作,真实耗时在事件循环调度上;maxWaitMs 给宽些,避免
// 全套件并行时 worker 卡顿超过窗口导致轮询测试偶发判 0(2026-10-05 遇到)
const noSleep = {sleep: async () => {}, retryMs: 1, maxWaitMs: 5000}

/** 只给第一个 QBX 手势配图,缩小断言面 */
const oneThumb = () => ({[seedPosesQbx[0].key]: '/thumbs/one.png'})

function stubFetch(ok = true) {
  const calls: string[] = []
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url))
    if (!ok) return {ok: false, status: 404} as Response
    return {ok: true, blob: async () => new Blob(['png'])} as Response
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = orig
    },
  }
}

describe('seedBuiltinPosesInto', () => {
  it('Y Bot 在库:按稳定 id 播种全部内置姿势(程序化+DPL+QBX 手势),rig 绑 Y Bot 骨架族', async () => {
    const {lib, put} = fakeLib([[{name: 'Y Bot', rig: 'rig-ybot'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(TOTAL)
    expect(put).toHaveLength(TOTAL)
    expect(put[0]).toMatchObject({
      id: 'seed-pose-' + seedPoses[0].key,
      kind: 'pose',
      name: seedPoses[0].name,
      rig: 'rig-ybot',
    })
    expect(Object.keys(put[0].kind === 'pose' ? put[0].bones : {})).toContain(
      'mixamorigHips',
    )
    // QBX 批(末批):最后一个条目是 seedPosesQbx 末位,id/rig 正确且手指骨在覆盖内
    const last = put[put.length - 1]
    expect(last).toMatchObject({
      id: 'seed-pose-' + seedPosesQbx[seedPosesQbx.length - 1].key,
      kind: 'pose',
      rig: 'rig-ybot',
    })
    expect(Object.keys(last.kind === 'pose' ? last.bones : {})).toContain(
      'mixamorigRightHandThumb1',
    )
    // QBX 是纯手势片段:只含 30 根手指骨,不含躯干骨
    expect(Object.keys(last.kind === 'pose' ? last.bones : {})).not.toContain(
      'mixamorigHips',
    )
    // 重复播种(同 id upsert)不产生异常
    const again = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(again).toBe(TOTAL)
  })

  it('Y Bot 迟迟未播种:轮询等到出现后播种', async () => {
    const {lib, put} = fakeLib([[], [], [{name: 'Y Bot', rig: 'rig-ybot'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(TOTAL)
    expect(put.length).toBe(TOTAL)
  })

  it('Y Bot 始终不在:返回 0 不写库', async () => {
    const {lib, put} = fakeLib([[{name: 'X Bot', rig: 'rig-x'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(0)
    expect(put).toHaveLength(0)
  })

  it('thumbs 传入且条目无图:拉取 PNG 存 blob 并挂 thumbnailId', async () => {
    const {lib, put, blobs} = fakeLib([[{name: 'Y Bot', rig: 'rig-ybot'}]])
    const fetchStub = stubFetch()
    try {
      const count = await seedBuiltinPosesInto(lib as never, {
        ...noSleep,
        thumbs: oneThumb(),
      })
      expect(count).toBe(TOTAL)
      expect(fetchStub.calls).toEqual(['/thumbs/one.png'])
      expect(blobs).toEqual(['blob-0'])
      const qbx0 = put.find((e) => e.id === 'seed-pose-' + seedPosesQbx[0].key)
      expect(qbx0).toMatchObject({thumbnailId: 'blob-0'})
      // 无图的条目不带 thumbnailId 字段
      const dpl0 = put.find((e) => e.id === 'seed-pose-' + seedPosesDpl[0].key)
      expect(dpl0 && 'thumbnailId' in dpl0).toBe(false)
    } finally {
      fetchStub.restore()
    }
  })

  it('条目已有 thumbnailId:不重复拉取,保留原图 id', async () => {
    const existing: PoseEntry = {
      id: 'seed-pose-' + seedPosesQbx[0].key,
      kind: 'pose',
      name: seedPosesQbx[0].name,
      rig: 'rig-ybot',
      thumbnailId: 'blob-old',
      bones: {},
      createdAt: 1,
    }
    const {lib, put, blobs} = fakeLib(
      [[{name: 'Y Bot', rig: 'rig-ybot'}]],
      [existing],
      ['blob-old'], // blob 真实存在才算有效引用
    )
    const fetchStub = stubFetch()
    try {
      await seedBuiltinPosesInto(lib as never, {...noSleep, thumbs: oneThumb()})
      expect(fetchStub.calls).toHaveLength(0)
      expect(blobs).toHaveLength(0)
      const qbx0 = put.find((e) => e.id === existing.id)
      expect(qbx0).toMatchObject({thumbnailId: 'blob-old'})
    } finally {
      fetchStub.restore()
    }
  })

  it('条目 thumbnailId 是死引用(blob 已被误删):重新拉取补挂', async () => {
    const existing: PoseEntry = {
      id: 'seed-pose-' + seedPosesQbx[0].key,
      kind: 'pose',
      name: seedPosesQbx[0].name,
      rig: 'rig-ybot',
      thumbnailId: 'blob-gone',
      bones: {},
      createdAt: 1,
    }
    const {lib, put, blobs} = fakeLib(
      [[{name: 'Y Bot', rig: 'rig-ybot'}]],
      [existing],
      [], // blob-gone 不存在
    )
    const fetchStub = stubFetch()
    try {
      await seedBuiltinPosesInto(lib as never, {...noSleep, thumbs: oneThumb()})
      expect(fetchStub.calls).toEqual(['/thumbs/one.png'])
      const qbx0 = put.find((e) => e.id === existing.id)
      expect(qbx0).toMatchObject({thumbnailId: 'blob-0'})
      expect(blobs).toEqual(['blob-0'])
    } finally {
      fetchStub.restore()
    }
  })

  it('预览图拉取失败:只告警,姿势本体照播不带 thumbnailId', async () => {
    const {lib, put, blobs} = fakeLib([[{name: 'Y Bot', rig: 'rig-ybot'}]])
    const fetchStub = stubFetch(false)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const count = await seedBuiltinPosesInto(lib as never, {
        ...noSleep,
        thumbs: oneThumb(),
      })
      expect(count).toBe(TOTAL)
      expect(blobs).toHaveLength(0)
      const qbx0 = put.find((e) => e.id === 'seed-pose-' + seedPosesQbx[0].key)
      expect(qbx0 && 'thumbnailId' in qbx0).toBe(false)
    } finally {
      fetchStub.restore()
      warn.mockRestore()
    }
  })
})
