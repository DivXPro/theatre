import {LibraryError, isWritableSource} from './source'
import type {LibrarySource, WritableLibrarySource} from './source'

test('LibraryError 携带 code 与 cause', () => {
  const cause = new Error('boom')
  const err = new LibraryError('quota', '配额已满', cause)
  expect(err.code).toBe('quota')
  expect(err.cause).toBe(cause)
  expect(err instanceof Error).toBe(true)
})

test('isWritableSource:有 putEntry 才判定可写', () => {
  const ro: LibrarySource = {
    id: 'ro',
    listEntries: async () => [],
    getEntry: async () => undefined,
    getBlobUrl: async () => '',
  }
  const rw: WritableLibrarySource = {
    ...ro,
    id: 'rw',
    putEntry: async () => {},
    deleteEntry: async () => {},
    putBlob: async () => 'x',
    deleteBlob: async () => {},
    getRigAliases: async () => [],
    putRigAlias: async () => {},
  }
  expect(isWritableSource(ro)).toBe(false)
  expect(isWritableSource(rw)).toBe(true)
})
