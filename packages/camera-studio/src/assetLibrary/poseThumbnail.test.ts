// packages/playground/src/shared/camera/assetLibrary/poseThumbnail.test.ts
/**
 * 姿势缩略图回填的筛选/分组逻辑(WebGL 渲染本体经 renderBatch 注入替身,
 * jsdom 不起 GL):只补「身体姿势 + 无图或死引用」的条目,按骨架族分组,
 * 无同族模型的跳过,单族渲染失败不影响其他族。
 */
import {backfillPoseThumbnails} from './poseThumbnail'
import type {ModelEntry, PoseEntry} from './types'

const BODY = {
  mixamorigHips: {rotation: [0, 0, 0, 1] as [number, number, number, number]},
}
const FINGERS = {
  mixamorigLeftHandThumb1: {
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  },
}

function pose(id: string, rig: string, thumbnailId?: string): PoseEntry {
  return {
    id,
    kind: 'pose',
    name: id,
    rig,
    bones: BODY,
    ...(thumbnailId ? {thumbnailId} : {}),
    createdAt: 1,
  }
}

function fakeLib(args: {
  poses?: PoseEntry[]
  models?: Partial<ModelEntry>[]
  blobIds?: string[]
}) {
  return {
    listEntries: async (kind?: string) =>
      kind === 'model'
        ? ([{blobId: 'glb-1', rig: 'rig-a'}, ...(args.models ?? [])] as never)
        : args.poses ?? [],
    listBlobIds: async () => args.blobIds ?? [],
    getBlobUrl: async (b: string) => 'blob:' + b,
    putBlobWithEntry: async () => {},
  }
}

test('回填筛选:无图/死引用的身体姿势才渲染;手势与活引用跳过', async () => {
  const lib = fakeLib({
    poses: [
      pose('p-no-thumb', 'rig-a'),
      pose('p-live', 'rig-a', 'blob-live'), // 活引用
      pose('p-dead', 'rig-a', 'blob-gone'), // 死引用
      // 纯手势条目(全身取景看不清手,且有随包图)
      {...pose('p-hand', 'rig-a'), bones: FINGERS},
    ],
    blobIds: ['blob-live'],
  })
  const seen: string[][] = []
  const n = await backfillPoseThumbnails(lib as never, {
    renderBatch: async (_lib, _model, entries) => {
      seen.push(entries.map((e) => e.id))
      return entries.length
    },
  })
  expect(seen).toEqual([['p-no-thumb', 'p-dead']])
  expect(n).toBe(2)
})

test('按骨架族分组渲染;无同族模型的族跳过', async () => {
  const lib = fakeLib({
    poses: [pose('p-a', 'rig-a'), pose('p-x', 'rig-x')],
  })
  const seen: string[][] = []
  const n = await backfillPoseThumbnails(lib as never, {
    renderBatch: async (_lib, model, entries) => {
      seen.push([model.rig, ...entries.map((e) => e.id)])
      return entries.length
    },
  })
  expect(seen).toEqual([['rig-a', 'p-a']])
  expect(n).toBe(1)
})

test('单族渲染失败只告警,不影响其他族', async () => {
  const lib = fakeLib({
    poses: [pose('p-a', 'rig-a'), pose('p-b', 'rig-b')],
    models: [{blobId: 'glb-2', rig: 'rig-b'}],
  })
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const n = await backfillPoseThumbnails(lib as never, {
      renderBatch: async (_lib, model, entries) => {
        if (model.rig === 'rig-a') throw new Error('GL 崩了')
        return entries.length
      },
    })
    expect(n).toBe(1)
  } finally {
    warn.mockRestore()
  }
})
