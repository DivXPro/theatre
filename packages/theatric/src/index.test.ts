/* eslint-disable no-restricted-syntax, @typescript-eslint/no-var-requires */
import type {$IntentionalAny} from '@toy-box/core/types/public'

/**
 * theatric holds `_project`/`_projectConfig` as module-level singletons, so
 * each test loads a fresh copy of the module.
 */
const loadTheatric = () => {
  // registerCoreBundle() writes the bundle globals on the first module eval; a
  // later resetModules()+require would otherwise hit the "loaded more than
  // once" guard. Clear them so each load starts clean (same pattern as
  // packages/core/src/index.test.ts).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {globalVariableNames} =
    require('@toy-box/core/globals') as $IntentionalAny
  delete (global as $IntentionalAny)[globalVariableNames.coreBundle]
  delete (global as $IntentionalAny)[globalVariableNames.StudioBundle]
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./index') as $IntentionalAny
}

// Minimal valid on-disk state — `getProject` shallow-validates
// `definitionVersion` and destructures `revisionHistory`/`sheetsById`.
const validState = {
  sheetsById: {},
  revisionHistory: [],
  definitionVersion: '0.4.0',
}

describe('button', () => {
  test('wraps an onClick into a button action', () => {
    const onClick = () => {}
    const theatric = loadTheatric()
    expect(theatric.button(onClick)).toEqual({type: 'button', onClick})
  })
})

describe('initialize', () => {
  test('resolves the project.ready promise', async () => {
    const theatric = loadTheatric()
    await expect(
      theatric.initialize({state: validState}),
    ).resolves.toBeUndefined()
  })

  test('is idempotent: a second call warns and returns the same ready promise', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const theatric = loadTheatric()
      const first = theatric.initialize({state: validState})
      const second = theatric.initialize({state: validState})
      expect(warnSpy).toHaveBeenCalledTimes(1)
      await first
      await expect(second).resolves.toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('getAssetUrl', () => {
  test('throws before initialize is called', () => {
    const theatric = loadTheatric()
    expect(() => theatric.getAssetUrl({type: 'image', id: 'pic-1'})).toThrow(
      /not been initialized/,
    )
  })

  test('throws while the project is still initializing', () => {
    const theatric = loadTheatric()
    // deliberately not awaited — the project is not ready yet
    void theatric.initialize({state: validState})
    expect(() => theatric.getAssetUrl({type: 'image', id: 'pic-1'})).toThrow(
      /before.*initialize.*is resolved|is resolved/,
    )
  })

  test('delegates to project.getAssetUrl once ready — image/file by id', async () => {
    const theatric = loadTheatric()
    await theatric.initialize({
      state: validState,
      assets: {baseUrl: '/assets'},
    })
    expect(theatric.getAssetUrl({type: 'image', id: 'pic-1'})).toBe(
      '/assets/pic-1',
    )
    expect(theatric.getAssetUrl({type: 'file', id: 'docs.pdf'})).toBe(
      '/assets/docs.pdf',
    )
    // an asset without an id has no URL
    expect(theatric.getAssetUrl({type: 'image', id: undefined})).toBeUndefined()
  })
})
