import {Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import {cloneBoneTree} from './exportGLB'

describe('cloneBoneTree', () => {
  it('只保留骨骼节点(名字/变换),剔除网格', () => {
    const root = new Group()
    const hips = new Bone()
    hips.name = 'Hips'
    hips.position.set(0, 1, 0)
    const spine = new Bone()
    spine.name = 'Spine'
    hips.add(spine)
    const prop = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    prop.name = 'SwordMesh'
    spine.add(prop) // 挂在骨骼上的网格不应进动画 GLB
    root.add(hips)
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))

    const clone = cloneBoneTree(root)
    const names: string[] = []
    clone.traverse((o) => names.push(`${o.name}:${o.type}`))
    expect(names).toEqual(['AnimationRig:Group', 'Hips:Bone', 'Spine:Bone'])
    const hipsClone = clone.children[0]
    expect(hipsClone.position.y).toBe(1)
    expect(hipsClone).not.toBe(hips) // 是克隆不是引用
  })

  it('多根骨骼并列保留', () => {
    const root = new Group()
    for (const name of ['L', 'R']) {
      const b = new Bone()
      b.name = name
      root.add(b)
    }
    expect(cloneBoneTree(root).children.map((c) => c.name)).toEqual(['L', 'R'])
  })
})
