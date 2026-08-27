import {
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three'
import {cloneBoneTree, exportModelGLB, stripInvalidTextures} from './exportGLB'

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

describe('stripInvalidTextures', () => {
  it('image 缺失的贴图被移除,有效贴图保留', () => {
    const root = new Group()
    const mat = new MeshStandardMaterial()
    mat.map = new Texture() // image === null:FBX 引用外部贴图加载失败后的状态
    mat.normalMap = new Texture()
    // ImageData 类(带 data + 宽高)是 GLTFExporter 可处理的有效形态
    const validTex = new Texture({
      data: new Uint8Array(4),
      width: 1,
      height: 1,
    } as any)
    mat.emissiveMap = validTex
    root.add(new Mesh(new BoxGeometry(), mat))

    expect(stripInvalidTextures(root)).toBe(2)
    expect(mat.map).toBeNull()
    expect(mat.normalMap).toBeNull()
    expect(mat.emissiveMap).toBe(validTex)
  })

  it('多材质数组逐个检查', () => {
    const root = new Group()
    const bad = new MeshStandardMaterial({map: new Texture()})
    const good = new MeshBasicMaterial()
    root.add(new Mesh(new BoxGeometry(), [bad, good]))
    expect(stripInvalidTextures(root)).toBe(1)
    expect(bad.map).toBeNull()
  })
})

describe('exportModelGLB', () => {
  it('贴图无效时剥掉后照常导出(不再抛错拖垮导入)', async () => {
    const root = new Group()
    const mat = new MeshStandardMaterial()
    mat.map = new Texture() // 修复前:GLTFExporter 抛 "No valid image data found"
    root.add(new Mesh(new BoxGeometry(), mat))

    const glb = await exportModelGLB(root)
    expect(glb.byteLength).toBeGreaterThan(0)
    expect(mat.map).toBeNull()
  })
})
