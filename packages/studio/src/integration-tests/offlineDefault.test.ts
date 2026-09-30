import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import {sanitizeOptsForTest} from '@dreamerbird/studio/sanitizeOpts'

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

test('workspaceButton is passed through when valid', () => {
  const config = {
    team: 'Camera',
    name: 'Playground',
    icon: 'emoji-or-jsx',
    menu: [{label: 'Settings', onClick: () => {}}],
  }
  expect(sanitizeOptsForTest({workspaceButton: config}).workspaceButton).toBe(
    config,
  )
})

test('workspaceButton defaults to undefined', () => {
  expect(sanitizeOptsForTest(undefined).workspaceButton).toBeUndefined()
})

test('workspaceButton is validated when provided', () => {
  expect(() =>
    sanitizeOptsForTest({workspaceButton: 'nope'} as $IntentionalAny),
  ).toThrow()
  expect(() =>
    sanitizeOptsForTest({workspaceButton: {menu: 'nope'}} as $IntentionalAny),
  ).toThrow()
  expect(() =>
    sanitizeOptsForTest({
      workspaceButton: {menu: [{label: 1, onClick: () => {}}]},
    } as $IntentionalAny),
  ).toThrow()
  expect(() =>
    sanitizeOptsForTest({
      workspaceButton: {menu: [{label: 'ok', onClick: 'nope'}]},
    } as $IntentionalAny),
  ).toThrow()
})
