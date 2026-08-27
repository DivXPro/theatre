import {
  AnimationClip,
  Bone,
  Group,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import {executeImport, planImport} from './importPipeline'
import type {ImportDeps} from './importPipeline'
import {Library} from './library'
import type {LibraryBackend, LibraryEntry, ModelEntry} from './types'

function skinnedModel(...bones: string[]): Group {
  const root = new Group()
  for (const name of bones) {
    const b = new Bone()
    b.name = name
    root.add(b)
  }
  root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  return root
}
const clip = (name: string) => new AnimationClip(name, 1.5, [])
const file = (name: string, content = 'x') => new File([content], name)

function depsFor(
  map: Record<string, {root: Group; animations: AnimationClip[]}>,
): ImportDeps {
  return {
    load: async (f) => {
      const hit = map[f.name]
      if (!hit) throw new Error('无法解析')
      return hit
    },
    exportModel: async () => new TextEncoder().encode('model-glb').buffer,
    exportAnimation: async (_root, c) =>
      new TextEncoder().encode('anim:' + c.name).buffer,
  }
}

function memoryBackend(existing: LibraryEntry[] = []): LibraryBackend {
  const entries = new Map(existing.map((e) => [e.id, e]))
  return {
    listEntries: async (kind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id) => entries.get(id),
    putEntry: async (e) => void entries.set(e.id, e),
    deleteEntry: async (id) => void entries.delete(id),
    putBlob: async () => 'blob-' + Math.random().toString(36).slice(2),
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
    listBlobIds: async () => [],
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  }
}

describe('planImport', () => {
  it('模型文件:1 模型 + 动画逐个提取', async () => {
    const plan = await planImport(
      [file('hero.fbx')],
      memoryBackend(),
      depsFor({
        'hero.fbx': {
          root: skinnedModel('Hips'),
          animations: [clip('idle'), clip('run')],
        },
      }),
    )
    expect(plan.items.map((i) => i.type)).toEqual([
      'model',
      'animation',
      'animation',
    ])
    expect(plan.items[1]).toMatchObject({name: 'idle', duration: 1.5})
    expect(plan.summary).toContain('模型 ×1')
    expect(plan.summary).toContain('动作 ×2')
  })

  it('纯动画文件:只出动作,不出模型', async () => {
    const root = new Group()
    const b = new Bone()
    b.name = 'Hips'
    root.add(b)
    const plan = await planImport(
      [file('walk.fbx')],
      memoryBackend(),
      depsFor({'walk.fbx': {root, animations: [clip('walk')]}}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['animation'])
  })

  it('模型导出失败:记跳过且不拖垮整批,动作照常提取', async () => {
    const deps = depsFor({
      'kate.fbx': {
        root: skinnedModel('Hips'),
        animations: [clip('idle')],
      },
    })
    deps.exportModel = async () => {
      throw new Error('THREE.GLTFExporter: No valid image data found')
    }
    // 修复前:planImport 直接拒绝,整批导入无声消失
    const plan = await planImport([file('kate.fbx')], memoryBackend(), deps)
    expect(plan.items.map((i) => i.type)).toEqual(['skip', 'animation'])
    expect(plan.items[0]).toMatchObject({
      name: 'kate',
      reason: '模型导出失败',
    })
  })

  it('单条动作导出失败:只跳过该条,其余动作保留', async () => {
    const deps = depsFor({
      'mix.fbx': {
        root: skinnedModel('Hips'),
        animations: [clip('bad'), clip('good')],
      },
    })
    const realExportAnim = deps.exportAnimation
    deps.exportAnimation = async (root, c) => {
      if (c.name === 'bad') throw new Error('export boom')
      return realExportAnim(root, c)
    }
    const plan = await planImport([file('mix.fbx')], memoryBackend(), deps)
    expect(plan.items.map((i) => i.type)).toEqual([
      'model',
      'skip',
      'animation',
    ])
    expect(plan.items[1]).toMatchObject({
      name: 'mix/bad',
      reason: '动作导出失败',
    })
  })

  it('完全相同的模型已在库中:跳过模型,只收新动作', async () => {
    // 第一层去重:contentHash 命中。假导出器输出固定字节,先算出会命中的 hash
    const probe = await planImport(
      [file('a.fbx')],
      memoryBackend(),
      depsFor({'a.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    const hash = (probe.items[0] as any).contentHash
    const existing: ModelEntry = {
      id: 'm0',
      kind: 'model',
      name: '角色A',
      rig: 'rig-x',
      blobId: 'b',
      contentHash: hash,
      boneCount: 1,
      vertexCount: 24,
      createdAt: 1,
    }
    const plan = await planImport(
      [file('b.fbx')],
      memoryBackend([existing]),
      depsFor({
        'b.fbx': {root: skinnedModel('Hips'), animations: [clip('jump')]},
      }),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['skip', 'animation'])
    expect(plan.items[0]).toMatchObject({
      reason: expect.stringContaining('已存在'),
    })
  })

  it('哈希不同但同族同结构:记入 similar 由用户定', async () => {
    const existing: ModelEntry = {
      id: 'm0',
      kind: 'model',
      name: '角色A',
      rig: 'rig-x',
      blobId: 'b',
      contentHash: 'different',
      boneCount: 1,
      vertexCount: 24,
      createdAt: 1,
    }
    // 让 rig 相同:需要真实骨骼名一致——rigIdOf 是真算的,existing.rig 要对上
    const probePlan = await planImport(
      [file('c.fbx')],
      memoryBackend(),
      depsFor({'c.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    existing.rig = (probePlan.items[0] as any).rig
    const plan = await planImport(
      [file('c.fbx')],
      memoryBackend([{...existing, contentHash: 'different'}]),
      depsFor({'c.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    expect(plan.similar).toEqual([
      {index: 0, existingName: '角色A', newName: 'c'},
    ])
  })

  it('姿势 JSON / 无法识别 / 解析失败', async () => {
    const pose = new File(
      [JSON.stringify({rig: 'rig-x', bones: {Hips: {rotation: [0, 0, 0, 1]}}})],
      '弓步.pose.json',
    )
    const plan = await planImport(
      [pose, file('empty.fbx'), file('bad.fbx')],
      memoryBackend(),
      depsFor({'empty.fbx': {root: new Group(), animations: []}}),
    )
    expect(plan.items.map((i) => i.type)).toEqual(['pose', 'skip', 'skip'])
    expect(plan.items[0]).toMatchObject({name: '弓步', rig: 'rig-x'})
  })
})

describe('executeImport', () => {
  it('按 choices 丢弃 similar 模型,其余落库并触发事件', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    let events = 0
    lib.subscribe(() => events++)
    const plan = await planImport(
      [file('hero.fbx')],
      backend,
      depsFor({
        'hero.fbx': {root: skinnedModel('Hips'), animations: [clip('idle')]},
      }),
    )
    plan.similar.push({index: 0, existingName: '旧', newName: 'hero'})
    await executeImport(plan, ['reuse'], lib)
    const entries = await backend.listEntries()
    expect(entries.map((e) => e.kind)).toEqual(['animation']) // 模型被 reuse 丢弃
    expect(events).toBe(1)
  })

  it('choices 选 keep 时模型照常入库', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    const plan = await planImport(
      [file('hero.fbx')],
      backend,
      depsFor({'hero.fbx': {root: skinnedModel('Hips'), animations: []}}),
    )
    plan.similar.push({index: 0, existingName: '旧', newName: 'hero'})
    await executeImport(plan, ['keep'], lib)
    expect((await backend.listEntries('model')).length).toBe(1)
  })
})
