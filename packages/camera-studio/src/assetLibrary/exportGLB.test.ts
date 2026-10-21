import {
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three'
import {
  NORMALIZED_MAX_DIM,
  bakeNormalizedScale,
  cloneBoneTree,
  exportModelGLB,
  stripInvalidTextures,
} from './exportGLB'

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

  it('入库时把源单位换算烘进根节点缩放(放置时缩放基线才是 1)', async () => {
    // 模拟 Mixamo FBX 厘米单位:180 单位高的人
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(50, 180, 30), new MeshBasicMaterial()))

    const glb = await exportModelGLB(root)
    expect(glb.byteLength).toBeGreaterThan(0)
    expect(root.scale.x).toBeCloseTo(NORMALIZED_MAX_DIM / 180, 6)
    expect(root.scale.y).toBe(root.scale.x)
    expect(root.scale.z).toBe(root.scale.x)
  })
})

describe('bakeNormalizedScale', () => {
  it('最长边烘成 NORMALIZED_MAX_DIM,按最长边而非高度', () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(12, 3, 4), new MeshBasicMaterial()))
    expect(bakeNormalizedScale(root)).toBeCloseTo(NORMALIZED_MAX_DIM / 12, 6)
    expect(root.scale.x).toBeCloseTo(NORMALIZED_MAX_DIM / 12, 6)
  })

  it('已达标模型不动(幂等,重烘已烘焙资产系数为 1)', () => {
    const root = new Group()
    root.add(
      new Mesh(
        new BoxGeometry(NORMALIZED_MAX_DIM, 1, 1),
        new MeshBasicMaterial(),
      ),
    )
    expect(bakeNormalizedScale(root)).toBe(1)
    expect(root.scale.x).toBe(1)
  })

  it('空模型(无边几何时)返回 1 且不动缩放', () => {
    const root = new Group()
    expect(bakeNormalizedScale(root)).toBe(1)
    expect(root.scale.x).toBe(1)
  })

  it('骨骼局部数据不受影响(动画轨道寻址的那层)', () => {
    const root = new Group()
    const hips = new Bone()
    hips.name = 'Hips'
    hips.position.set(0, 90, 0)
    const mesh = new Mesh(new BoxGeometry(50, 180, 30), new MeshBasicMaterial())
    hips.add(mesh)
    root.add(hips)

    bakeNormalizedScale(root)
    expect(hips.position.y).toBe(90) // 只有根节点 scale 变了
    expect(root.scale.x).toBeCloseTo(NORMALIZED_MAX_DIM / 180, 6)
  })
})
