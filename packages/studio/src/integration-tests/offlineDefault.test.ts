import {sanitizeOptsForTest} from '@toy-box/studio/sanitizeOpts'

test('serverUrl defaults to undefined (no cloud backend)', () => {
  const opts = sanitizeOptsForTest(undefined)
  expect(opts.serverUrl).toBeUndefined()
  expect(opts.persistenceKey).toBeDefined()
})

test('serverUrl is validated when provided', () => {
  expect(() => sanitizeOptsForTest({serverUrl: 'not a url'})).toThrow()
  expect(
    sanitizeOptsForTest({serverUrl: 'http://localhost:3000'}).serverUrl,
  ).toBe('http://localhost:3000')
})
