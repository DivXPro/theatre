import {Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {hashBytes, hashString} from './hash'
import {collectBoneNames, meshStats, rigIdOf} from './rig'

function makeRig(...names: string[]): Group {
  const root = new Group()
  let parent: Bone | undefined
  for (const name of names) {
    const bone = new Bone()
    bone.name = name
    if (parent) parent.add(bone)
    else root.add(bone)
    parent = bone
  }
  return root
}

describe('hashBytes', () => {
  it('同样输入同样输出,不同输入不同输出', () => {
    const a = new Uint8Array([1, 2, 3])
    expect(hashBytes(a)).toBe(hashBytes(new Uint8Array([1, 2, 3])))
    expect(hashBytes(a)).not.toBe(hashBytes(new Uint8Array([1, 2, 4])))
    expect(hashBytes(a)).toMatch(/^[0-9a-f]{16}$/)
  })
  it('hashString 对字符串稳定', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('rigIdOf', () => {
  it('同一套骨骼名(顺序不同)得到同一个骨架族 id', () => {
    expect(rigIdOf(makeRig('Hips', 'Spine', 'Head'))).toBe(
      rigIdOf(makeRig('Head', 'Hips', 'Spine')),
    )
  })
  it('不同骨骼名得到不同 id', () => {
    expect(rigIdOf(makeRig('Hips'))).not.toBe(rigIdOf(makeRig('Legs')))
  })
  it('没有骨骼返回 static', () => {
    const g = new Group()
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    expect(rigIdOf(g)).toBe('static')
  })
})

describe('meshStats', () => {
  it('统计网格数和顶点数', () => {
    const g = makeRig('Hips')
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    expect(meshStats(g)).toEqual({meshCount: 2, vertexCount: 48})
  })
})

describe('collectBoneNames', () => {
  it('返回排序后的骨骼名', () => {
    expect(collectBoneNames(makeRig('b', 'a', 'c'))).toEqual(['a', 'b', 'c'])
  })
})
