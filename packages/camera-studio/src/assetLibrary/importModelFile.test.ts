/**
 * importModelFile:宿主外部模型入库——planImport + executeImport 复用
 * 既有导入管线,按 id 差分找回新建条目返回。假 backend/deps 模式同
 * importPipeline.test.ts。
 */
import {importModelFile} from './importModelFile'
import type {ImportDeps} from './importPipeline'
import {Library} from './library'
import type {LibraryBackend, LibraryEntry} from './types'
import {Group, Bone, Mesh, BoxGeometry, MeshBasicMaterial} from 'three'

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

function depsFor(map: Record<string, {root: Group}>): ImportDeps {
  return {
    load: async (f) => {
      const hit = map[f.name]
      if (!hit) throw new Error('无法解析')
      return {root: hit.root, animations: []}
    },
    // 不同模型的导出字节必须不同,否则 planImport 的内容哈希去重会把
    // 第二个模型误判为"已存在"而跳过(真实导出器天然满足)
    exportModel: async (root) => {
      const names: string[] = []
      root.traverse((o) => names.push(o.name))
      return new TextEncoder().encode('glb:' + names.join('|')).buffer
    },
    exportAnimation: async () => new TextEncoder().encode('anim').buffer,
  }
}

function memoryBackend(existing: LibraryEntry[] = []): LibraryBackend {
  const entries = new Map(existing.map((e) => [e.id, e]))
  return {
    id: 'mock',
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
  } as LibraryBackend
}

describe('importModelFile', () => {
  it('导入 FBX 后返回新建的 model 条目', async () => {
    const backend = memoryBackend()
    const library = new Library({sources: [backend]})
    const deps = depsFor({'robot.fbx': {root: skinnedModel('hips')}})
    const file = new File(['x'], 'robot.fbx')
    const entry = await importModelFile(file, library, deps)
    expect(entry.kind).toBe('model')
    // 条目真实入库:再列一次拿得到
    const all = await backend.listEntries('model')
    expect(all.some((e) => e.id === entry.id)).toBe(true)
  })
  it('连续导入两个模型,各自返回各自的新条目', async () => {
    const backend = memoryBackend()
    const library = new Library({sources: [backend]})
    const deps = depsFor({
      'a.fbx': {root: skinnedModel('hips')},
      'b.fbx': {root: skinnedModel('spine')},
    })
    const first = await importModelFile(new File(['x'], 'a.fbx'), library, deps)
    const second = await importModelFile(
      new File(['x'], 'b.fbx'),
      library,
      deps,
    )
    expect(first.id).not.toBe(second.id)
    expect((await backend.listEntries('model')).length).toBe(2)
  })
})
