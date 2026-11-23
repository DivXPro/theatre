import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import SaazBack from '../../../saaz/src/back/SaazBack'
import {BackFileAdapter} from './BackFileAdapter'
import type {
  $IntentionalAny,
  Schema,
  Transaction,
} from '@dreamerbird/saaz/src/types'

jest.setTimeout(10000)

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

const tx = (peerClock: number): Transaction => ({
  invokations: [],
  generatorRecordings: {},
  peerId: 'p1',
  peerClock,
  draftOps: [],
})

const withTempDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'theatre-sync-state-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
}

test('persists values across adapter instances', async () => {
  await withTempDir(async (dir) => {
    const first = new BackFileAdapter({dir, dbName: 'project/one'})
    await first.set('snapshot', {op: {count: 3}, cell: {}})
    await first.set('clock', 7)
    await first.close()

    const second = new BackFileAdapter({dir, dbName: 'project/one'})
    expect(await second.get('snapshot')).toEqual({op: {count: 3}, cell: {}})
    expect(await second.get('clock')).toBe(7)
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0].endsWith('.json')).toBe(true)
    await second.close()
  })
})

test('isolates databases and restores Saaz snapshot plus clock', async () => {
  await withTempDir(async (dir) => {
    const firstAdapter = new BackFileAdapter({
      dir,
      dbName: 'camera-animation-qa',
    })
    const first = new SaazBack({
      dbName: 'camera-animation-qa',
      storageAdapter: firstAdapter,
      schema,
    })
    await first.ready
    await first.applyUpdates({
      peerId: 'p1',
      backendClock: null,
      updates: [tx(0)],
    })
    await firstAdapter.close()

    const other = new SaazBack({
      dbName: 'another-project',
      storageAdapter: new BackFileAdapter({dir, dbName: 'another-project'}),
      schema,
    })
    await other.ready
    expect(
      (await other.getUpdatesSinceClock({clock: null, peerId: 'p2'}))
        .hasUpdates,
    ).toBe(false)

    const restored = new SaazBack({
      dbName: 'camera-animation-qa',
      storageAdapter: new BackFileAdapter({dir, dbName: 'camera-animation-qa'}),
      schema,
    })
    await restored.ready
    const result = await restored.getUpdatesSinceClock({
      clock: null,
      peerId: 'p3',
    })
    expect(result.clock).toBe(0)
    expect(result.hasUpdates).toBe(true)
  })
})

test('rejects a corrupt state file instead of overwriting it', async () => {
  await withTempDir(async (dir) => {
    const adapter = new BackFileAdapter({dir, dbName: 'broken'})
    await writeFile(adapter.filePath, '{', 'utf8')
    await expect(adapter.get('clock')).rejects.toThrow()
    await expect(adapter.set('clock', 1)).rejects.toThrow()
  })
})
