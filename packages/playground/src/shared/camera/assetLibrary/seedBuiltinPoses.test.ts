// packages/playground/src/shared/camera/assetLibrary/seedBuiltinPoses.test.ts
import {seedBuiltinPosesInto} from './seedBuiltinPoses'
import {seedPoses} from './seedPoses'
import type {LibraryEntry} from './types'

function fakeLib(models: {name: string; rig: string}[][]) {
  const put: LibraryEntry[] = []
  let call = 0
  const lib = {
    backend: {
      listEntries: async (kind: string) => {
        expect(kind).toBe('model')
        return models[Math.min(call++, models.length - 1)]
      },
    },
    putEntry: async (e: LibraryEntry) => {
      put.push(e)
    },
  }
  return {lib, put}
}

const noSleep = {sleep: async () => {}, retryMs: 1, maxWaitMs: 10}

describe('seedBuiltinPosesInto', () => {
  it('Y Bot 在库:按稳定 id 播种全部内置姿势,rig 绑 Y Bot 骨架族', async () => {
    const {lib, put} = fakeLib([[{name: 'Y Bot', rig: 'rig-ybot'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(seedPoses.length)
    expect(put).toHaveLength(seedPoses.length)
    expect(put[0]).toMatchObject({
      id: 'seed-pose-' + seedPoses[0].key,
      kind: 'pose',
      name: seedPoses[0].name,
      rig: 'rig-ybot',
    })
    expect(Object.keys(put[0].kind === 'pose' ? put[0].bones : {})).toContain(
      'mixamorigHips',
    )
    // 重复播种(同 id upsert)不产生异常
    const again = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(again).toBe(seedPoses.length)
  })

  it('Y Bot 迟迟未播种:轮询等到出现后播种', async () => {
    const {lib, put} = fakeLib([[], [], [{name: 'Y Bot', rig: 'rig-ybot'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(seedPoses.length)
    expect(put.length).toBe(seedPoses.length)
  })

  it('Y Bot 始终不在:返回 0 不写库', async () => {
    const {lib, put} = fakeLib([[{name: 'X Bot', rig: 'rig-x'}]])
    const count = await seedBuiltinPosesInto(lib as never, noSleep)
    expect(count).toBe(0)
    expect(put).toHaveLength(0)
  })
})
