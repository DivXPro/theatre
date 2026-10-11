import {Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial} from 'three'
import type {ImportDeps} from './importPipeline'
import {Library} from './library'
import {seedModels, SEED_RIG_ALIAS} from './seedModels'
import type {LibraryBackend, LibraryEntry, RigAlias} from './types'

function skinnedModel(): Group {
  const root = new Group()
  const b = new Bone()
  b.name = 'mixamorig:Hips'
  root.add(b)
  root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  return root
}

const file = (name: string) => new File(['x'], name)

/**
 * 假管线:导出字节按「文件名 + 版本」编码——同一文件多次解析字节一致
 * (内容哈希命中),version 变了则哈希变(触发 similar 的素材)。
 */
function depsFor(
  names: string[],
  version = 'v1',
): ImportDeps & {loaded: string[]} {
  const loaded: string[] = []
  let current = ''
  return {
    loaded,
    load: async (f) => {
      if (!names.includes(f.name)) throw new Error('无法解析')
      loaded.push(f.name)
      current = f.name
      return {root: skinnedModel(), animations: []}
    },
    exportModel: async () =>
      new TextEncoder().encode(`model-glb:${current}:${version}`).buffer,
    exportAnimation: async (_root, c) =>
      new TextEncoder().encode('anim:' + c.name).buffer,
  }
}

function memoryBackend(existing: LibraryEntry[] = []): LibraryBackend & {
  aliases: RigAlias[]
} {
  const entries = new Map(existing.map((e) => [e.id, e]))
  const aliases: RigAlias[] = []
  return {
    aliases,
    listEntries: async (kind) =>
      [...entries.values()].filter((e) => !kind || e.kind === kind),
    getEntry: async (id) => entries.get(id),
    putEntry: async (e) => void entries.set(e.id, e),
    deleteEntry: async (id) => void entries.delete(id),
    putBlob: async () => 'blob-' + Math.random().toString(36).slice(2),
    getBlobUrl: async () => 'blob:x',
    deleteBlob: async () => {},
    listBlobIds: async () => [],
    getRigAliases: async () => aliases,
    putRigAlias: async (a) => {
      const i = aliases.findIndex((x) => x.rig === a.rig)
      if (i >= 0) aliases[i] = a
      else aliases.push(a)
    },
  }
}

const SEED_NAMES = ['X Bot.fbx', 'Y Bot.fbx', 'Eve.fbx']

describe('seedModels', () => {
  it('首次播种:全部入库,骨架族别名设为 Mixamo', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES))
    const models = await backend.listEntries('model')
    expect(models.map((e) => e.name).sort()).toEqual(['Eve', 'X Bot', 'Y Bot'])
    expect(backend.aliases).toEqual([
      {rig: (models[0] as any).rig, name: SEED_RIG_ALIAS},
    ])
  })

  it('名单齐全时直接跳过:不解析任何文件(省掉每次挂载重解析)', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES))
    const deps = depsFor(SEED_NAMES)
    await seedModels(SEED_NAMES.map(file), lib, deps)
    expect(deps.loaded).toEqual([])
    expect((await backend.listEntries('model')).length).toBe(3)
  })

  it('删掉一个后再播种:只重解析缺失文件并补回', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES))
    const models = await backend.listEntries('model')
    const eve = models.find((e) => e.name === 'Eve')!
    await lib.deleteEntry(eve.id)

    const deps2 = depsFor(SEED_NAMES)
    await seedModels(SEED_NAMES.map(file), lib, deps2)
    expect(deps2.loaded).toEqual(['Eve.fbx'])
    const after = await backend.listEntries('model')
    expect(after.map((e) => e.name).sort()).toEqual(['Eve', 'X Bot', 'Y Bot'])
  })

  it('用户改过名的种子模型:按名字缺员会重解析,但哈希命中跳过不入库', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES))
    const models = await backend.listEntries('model')
    const eve = models.find((e) => e.name === 'Eve')!
    await lib.renameEntry(eve.id, '伊芙')

    // 同文件同版本 → 导出字节一致 → 内容哈希命中 → skip
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES))
    const after = await backend.listEntries('model')
    expect(after.length).toBe(3)
    expect(after.map((e) => e.name).sort()).toEqual(['X Bot', 'Y Bot', '伊芙'])
  })

  it('similar 冲突自动 keep,不打扰用户', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels([file('X Bot.fbx')], lib, depsFor(SEED_NAMES))
    const first = (await backend.listEntries('model'))[0]!
    await lib.renameEntry(first.id, '守卫甲')
    // 种子文件换代(v2 字节不同):X Bot 改名后重解析,
    // 同族同顶点数但哈希不同 → similar;播种自动 keep 各留一份
    await seedModels(SEED_NAMES.map(file), lib, depsFor(SEED_NAMES, 'v2'))
    const names = (await backend.listEntries('model')).map((e) => e.name).sort()
    expect(names).toEqual(['Eve', 'X Bot', 'Y Bot', '守卫甲'])
  })

  it('已有骨架别名时不覆盖', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels([file('X Bot.fbx')], lib, depsFor(SEED_NAMES))
    await lib.setRigAlias(backend.aliases[0]!.rig, '自定义族')
    await seedModels([file('Y Bot.fbx')], lib, depsFor(SEED_NAMES))
    expect(backend.aliases).toEqual([
      {rig: backend.aliases[0]!.rig, name: '自定义族'},
    ])
  })

  it('空文件列表:什么都不做', async () => {
    const backend = memoryBackend()
    const lib = new Library(backend)
    await seedModels([], lib, depsFor([]))
    expect((await backend.listEntries()).length).toBe(0)
  })
})
