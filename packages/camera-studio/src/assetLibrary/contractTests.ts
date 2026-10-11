/**
 * 宿主存储实现的契约测试套件。宿主在自己仓库里:
 *   import {runLibrarySourceContractTests} from '@dreamerbird/camera-studio/contract-tests'
 *   runLibrarySourceContractTests(async () => ({source: new MyHttpSource(...)}))
 * 每个用例拿全新空实例;套件对内置 IDB 实现自身也跑(contract.indexeddb.test.ts)。
 */
import type {WritableLibrarySource} from './source'

export function runLibrarySourceContractTests(
  makeSource: () => Promise<{
    source: WritableLibrarySource
    cleanup?: () => Promise<void>
  }>,
): void {
  describe('LibrarySource 契约', () => {
    let ctx: {source: WritableLibrarySource; cleanup?: () => Promise<void>}
    beforeEach(async () => {
      ctx = await makeSource()
    })
    afterEach(async () => {
      await ctx.cleanup?.()
    })

    test('条目 round-trip:put → get/list → delete', async () => {
      const entry = {
        id: 'c1',
        kind: 'pose',
        name: '契约姿势',
        rig: 'r',
        bones: {},
      } as any
      await ctx.source.putEntry(entry)
      expect(await ctx.source.getEntry('c1')).toMatchObject({id: 'c1'})
      expect(await ctx.source.listEntries('pose')).toHaveLength(1)
      expect(await ctx.source.listEntries('model')).toHaveLength(0)
      await ctx.source.deleteEntry('c1')
      expect(await ctx.source.getEntry('c1')).toBeUndefined()
    })

    test('getEntry(不存在)→ undefined,不抛', async () => {
      await expect(ctx.source.getEntry('nope')).resolves.toBeUndefined()
    })

    test('同 id 重复 put = upsert 覆盖', async () => {
      const e = {id: 'c2', kind: 'pose', name: 'v1', rig: 'r', bones: {}} as any
      await ctx.source.putEntry(e)
      await ctx.source.putEntry({...e, name: 'v2'})
      expect((await ctx.source.getEntry('c2'))?.name).toBe('v2')
      expect(await ctx.source.listEntries()).toHaveLength(1)
    })

    test('blob round-trip + 内容寻址:同内容两次同 id', async () => {
      const data = new Blob(['hello'], {type: 'text/plain'})
      const id1 = await ctx.source.putBlob(data)
      const id2 = await ctx.source.putBlob(new Blob(['hello']))
      expect(id1).toBe(id2)
      const url = await ctx.source.getBlobUrl(id1)
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
      await ctx.source.deleteBlob(id1)
    })

    test('骨架别名 round-trip', async () => {
      await ctx.source.putRigAlias({rig: 'rig-x', name: '别名 X'} as any)
      const aliases = await ctx.source.getRigAliases()
      expect(
        aliases.some((a) => a.rig === 'rig-x' && a.name === '别名 X'),
      ).toBe(true)
    })
  })
}
