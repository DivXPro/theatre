import {indexedDB as fakeIndexedDB} from 'fake-indexeddb'

// jsdom 没有 indexedDB,也没有 URL.createObjectURL——都在 import 被测模块前装好
;(globalThis as any).indexedDB = fakeIndexedDB
;(URL as any).createObjectURL = jest.fn(() => 'blob:mock-url')
;(URL as any).revokeObjectURL = jest.fn()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {IndexedDBBackend} =
  require('./indexedDBBackend') as typeof import('./indexedDBBackend')

import {runLibrarySourceContractTests} from './contractTests'

runLibrarySourceContractTests(async () => ({
  source: new IndexedDBBackend({dbName: `contract-${Math.random()}`}),
}))
