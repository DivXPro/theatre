import {entryOptions} from './options'
import type {AnimationEntry, ModelEntry, PoseEntry} from './types'

const model = (id: string, rig: string): ModelEntry => ({
  id,
  kind: 'model',
  name: '模型' + id,
  rig,
  blobId: 'b-' + id,
  contentHash: 'h-' + id,
  boneCount: 1,
  vertexCount: 1,
  createdAt: 1,
})
const animation = (id: string, rig: string): AnimationEntry => ({
  id,
  kind: 'animation',
  name: '动作' + id,
  rig,
  blobId: 'b-' + id,
  contentHash: 'h-' + id,
  duration: 1,
  createdAt: 1,
})
const pose = (id: string, rig: string): PoseEntry => ({
  id,
  kind: 'pose',
  name: '姿势' + id,
  rig,
  bones: {},
  createdAt: 1,
})

describe('entryOptions', () => {
  const entries = [
    model('m1', 'rig-a'),
    model('m2', 'rig-b'),
    animation('a1', 'rig-a'),
    animation('a2', 'rig-b'),
    pose('p1', 'rig-a'),
    pose('p2', 'rig-b'),
  ]

  it('模型条目可解析时只列同族动作,并带空值选项', () => {
    expect(entryOptions(entries, 'animation', 'm1')).toEqual({
      '': '(无)',
      a1: '动作a1',
    })
  })

  it('姿势与动作互不混入', () => {
    expect(entryOptions(entries, 'pose', 'm2')).toEqual({
      '': '(无)',
      p2: '姿势p2',
    })
  })

  it('模型条目 id 解析不了(本地来源/快照未就绪)时不设限', () => {
    expect(entryOptions(entries, 'animation', undefined)).toEqual({
      '': '(无)',
      a1: '动作a1',
      a2: '动作a2',
    })
    // id 给了但快照里还没有(快照差一拍)同样列全部,不给用户一个空下拉
    expect(entryOptions(entries, 'animation', 'm-ghost')).toEqual({
      '': '(无)',
      a1: '动作a1',
      a2: '动作a2',
    })
  })

  it('库里没有该种类时只剩空值选项', () => {
    expect(entryOptions([model('m1', 'rig-a')], 'animation', 'm1')).toEqual({
      '': '(无)',
    })
  })
})
