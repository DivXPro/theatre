/* eslint-disable no-restricted-syntax */
import {BackStorage} from './BackStorage'
import SaazBack from './SaazBack'
import type {$IntentionalAny, BackStorageAdapter, Schema} from '../types'

type OpShape = {$schemaVersion: number; opCount: number}

const schema: Schema<OpShape, {}, {}, {}> = {
  opShape: null as $IntentionalAny as OpShape,
  version: 1,
  editors: {},
  generators: {},
  cellShape: {},
}

describe('BackStorage', () => {
  it('rejects ready when the adapter load fails', async () => {
    const adapter: BackStorageAdapter = {
      get: async () => {
        throw new Error('load boom')
      },
      set: async () => {},
      close: async () => {},
    }
    const storage = new BackStorage({storageAdapter: adapter})

    await expect(storage.ready).rejects.toThrow('load boom')
  })

  it('serializes saves in call order', async () => {
    const order: string[] = []
    const adapter: BackStorageAdapter = {
      get: async () => undefined,
      // a slow `set` so a non-serialized implementation would interleave
      set: async (key: string) => {
        order.push(key)
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
      close: async () => {},
    }
    const storage = new BackStorage({storageAdapter: adapter})
    await storage.ready

    const snapshot = {v: 1} as $IntentionalAny
    const p1 = storage.save(snapshot, 1)
    const p2 = storage.save(snapshot, 2)
    await Promise.all([p1, p2])

    // each save writes snapshot then clock, and saves run in call order
    expect(order).toEqual(['snapshot', 'clock', 'snapshot', 'clock'])
  })

  it('propagates save failures to the caller instead of swallowing them', async () => {
    const adapter: BackStorageAdapter = {
      get: async () => undefined,
      set: async () => {
        throw new Error('disk full')
      },
      close: async () => {},
    }
    const storage = new BackStorage({storageAdapter: adapter})
    await storage.ready

    await expect(storage.save({v: 1} as $IntentionalAny, 1)).rejects.toThrow(
      'disk full',
    )
  })

  it('keeps saving after a failed save (transient failures do not poison the queue)', async () => {
    let fail = true
    const order: string[] = []
    const adapter: BackStorageAdapter = {
      get: async () => undefined,
      set: async (key: string) => {
        order.push(key)
        if (fail) {
          fail = false
          throw new Error('transient')
        }
      },
      close: async () => {},
    }
    const storage = new BackStorage({storageAdapter: adapter})
    await storage.ready

    await expect(storage.save({v: 1} as $IntentionalAny, 1)).rejects.toThrow(
      'transient',
    )
    await storage.save({v: 2} as $IntentionalAny, 2)
    expect(order).toEqual(['snapshot', 'snapshot', 'clock'])
  })
})

describe('SaazBack.ready', () => {
  it('rejects when the storage load fails, so persistence degradation is observable', async () => {
    const adapter: BackStorageAdapter = {
      get: async () => {
        throw new Error('load boom')
      },
      set: async () => {},
      close: async () => {},
    }
    const back = new SaazBack({dbName: 'd', storageAdapter: adapter, schema})

    await expect(back.ready).rejects.toThrow('load boom')
  })
})
