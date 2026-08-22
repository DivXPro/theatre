import {globalVariableNames} from '@toy-box/core/globals'
import type {$IntentionalAny} from '@toy-box/core/types/public'

/**
 * Behavior tests for the core `init()` / `getStudio()` / `getStudioSync()`
 * flow. These are driven by module-level state (`initCalled`, the deferreds),
 * so each test starts from a fresh module instance via `jest.resetModules()`.
 */
describe('core init()/getStudio() flow', () => {
  beforeEach(() => {
    // registerCoreBundle() writes the bundle globals on the first module eval;
    // a later resetModules()+require would otherwise hit the "loaded more than
    // once" guard. Clear them so each test starts clean.
    delete (global as $IntentionalAny)[globalVariableNames.coreBundle]
    delete (global as $IntentionalAny)[globalVariableNames.StudioBundle]
    jest.resetModules()
  })

  test('getStudio() before init() rejects with a clear message', async () => {
    const {getStudio} = require('./index')

    await expect(getStudio()).rejects.toThrow(/not been initialized/i)
  })

  test('init() is idempotent — only the first call applies', async () => {
    const {init, getStudioSync} = require('./index')

    await init({studio: false})
    // A second call must be a no-op: it must not overwrite the first opts.
    await init({studio: true})

    // No studio bundle registers in a plain node/jest environment, so the
    // studio deferred stays pending and the sync accessor stays undefined.
    expect(getStudioSync()).toBe(undefined)
  })

  test('getStudioSync(true) throws when the studio is not ready', () => {
    const {getStudioSync} = require('./index')

    expect(() => getStudioSync(true)).toThrow(/not ready/i)
  })
})
