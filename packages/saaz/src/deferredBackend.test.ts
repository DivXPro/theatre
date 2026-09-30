import {createDeferredBackend} from './deferredBackend'
import SaazBack from './back/SaazBack'
import {BackMemoryAdapter} from './back/BackMemoryAdapter'
import {defer} from '@dreamerbird/utils/defer'
import type {$IntentionalAny, SaazBackInterface, Schema} from './types'

jest.setTimeout(5000)

test('deferred backend forwards calls to the resolved implementation', async () => {
  const schema: Schema<{$schemaVersion: number}, {}, {}, {}> = {
    opShape: null as $IntentionalAny,
    version: 1,
    editors: {},
    generators: {},
    cellShape: {},
  }
  const d = defer<SaazBackInterface>()
  const proxy = createDeferredBackend(d.promise)
  const resultPromise = proxy.getUpdatesSinceClock({clock: null, peerId: 'p'})
  d.resolve(
    new SaazBack({
      dbName: 'd',
      storageAdapter: new BackMemoryAdapter(),
      schema,
    }),
  )
  const res = await resultPromise
  expect(res.clock).toBe(-1)
})
