import {
  Bone,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from 'three'
import {
  CENTIMETER_SOURCE_THRESHOLD,
  bakeMetricScale,
  cloneBoneTree,
  exportModelGLB,
  metricScaleFactor,
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

  it('入库时把厘米源换算成米烘进根节点缩放(放置时缩放基线才是 1)', async () => {
    // 模拟 Mixamo FBX 厘米单位:180 单位高的人
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(50, 180, 30), new MeshBasicMaterial()))

    const glb = await exportModelGLB(root)
    expect(glb.byteLength).toBeGreaterThan(0)
    expect(root.scale.x).toBeCloseTo(0.01, 6)
    expect(root.scale.y).toBe(root.scale.x)
    expect(root.scale.z).toBe(root.scale.x)
  })
})

describe('metricScaleFactor', () => {
  it('厘米源(超过阈值)换算 0.01,米源不动', () => {
    expect(metricScaleFactor(180)).toBe(0.01)
    expect(metricScaleFactor(1.8)).toBe(1)
  })

  it('阈值边界:恰好阈值按米,超过才按厘米', () => {
    expect(metricScaleFactor(CENTIMETER_SOURCE_THRESHOLD)).toBe(1)
    expect(metricScaleFactor(CENTIMETER_SOURCE_THRESHOLD + 0.01)).toBe(0.01)
  })
})

describe('bakeMetricScale', () => {
  it('厘米源烘成米制真实尺寸(180 高的人 → 1.8)', () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(50, 180, 30), new MeshBasicMaterial()))
    expect(bakeMetricScale(root)).toBeCloseTo(0.01, 6)
    expect(root.scale.x).toBeCloseTo(0.01, 6)
    // 烘完最长边 = 1.8 场景单位(米),人高占比不变
    const box = new Box3().setFromObject(root)
    expect(box.getSize(new Vector3()).y).toBeCloseTo(1.8, 6)
  })

  it('米制模型不动(幂等,重烘已烘焙资产系数为 1)', () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(1.8, 1.8, 1.8), new MeshBasicMaterial()))
    expect(bakeMetricScale(root)).toBe(1)
    expect(root.scale.x).toBe(1)
  })

  it('空模型(无边几何时)返回 1 且不动缩放', () => {
    const root = new Group()
    expect(bakeMetricScale(root)).toBe(1)
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

    bakeMetricScale(root)
    expect(hips.position.y).toBe(90) // 只有根节点 scale 变了
    expect(root.scale.x).toBeCloseTo(0.01, 6)
  })
})
