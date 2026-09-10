/**
 * @jest-environment jsdom
 */
import {globalVariableNames} from '@dreamerbird/core/globals'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'

/**
 * Behavior tests for the "config.state is empty" guard in Project.
 *
 * When a project is created without `config.state`, core gives the studio a
 * 1s grace period to attach, then throws. Studio loading (dynamic import on
 * a cold dev server) can exceed 1s, so when `init({studio: true})` has been
 * called, core must suppress that throw entirely — the studio is expected
 * and will attach whenever it finishes loading.
 */
describe('Project empty-state guard vs init()', () => {
  beforeEach(() => {
    // registerCoreBundle() writes the bundle globals on the first module
    // eval; clear them so each test starts from a fresh module instance.
    delete (global as $IntentionalAny)[globalVariableNames.coreBundle]
    delete (global as $IntentionalAny)[globalVariableNames.StudioBundle]
    jest.resetModules()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('does not throw when init({studio: true}) was called, even if the studio has not attached within 1s', async () => {
    const {default: theatre, getProject} = require('../index')

    await theatre.init({studio: true})
    getProject('project awaiting studio')

    // let the init-opts microtask land (in a browser it always runs long
    // before the 1s macrotask)
    await Promise.resolve()

    expect(() => jest.advanceTimersByTime(5000)).not.toThrow()
  })

  test('still throws after the grace period when init() was never called', () => {
    const {getProject} = require('../index')

    getProject('project without init')

    expect(() => jest.advanceTimersByTime(5000)).toThrow(/is empty/)
  })

  test('still throws after the grace period when init() was called without the studio', async () => {
    const {default: theatre, getProject} = require('../index')

    await theatre.init({studio: false})
    getProject('project with studio disabled')

    await Promise.resolve()

    expect(() => jest.advanceTimersByTime(5000)).toThrow(/is empty/)
  })

  test('warns after 5s when init({studio: true}) was called but the studio never loads', async () => {
    const {default: theatre} = require('../index')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await theatre.init({studio: true})
    jest.advanceTimersByTime(6000)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/import '@dreamerbird\/studio'/),
    )
    warnSpy.mockRestore()
  })
})
