/**
 * AUTH_DISABLED=true = self-hosted minimal loop: the sync-server must boot and
 * serve clients without an app (no APP_URL → no jwt-public-key fetch) and
 * without a postgres DB, and `requireValidSession` must let requests through
 * without touching the token verifier.
 *
 * jest-esbuild does not hoist `jest.mock`, so a static import of
 * `./utils/authUtils` — directly, or transitively via `./trpc` — evaluates the
 * real module before the mock registers. The mock is therefore registered with
 * `jest.doMock`, the registry reset, and everything required fresh so `./trpc`'s
 * `import ... from 'src/utils/authUtils'` resolves the mock.
 */
import type {$IntentionalAny} from '@dreamerbird/utils/types'

const originalEnv: Record<string, string | undefined> = {
  AUTH_DISABLED: process.env.AUTH_DISABLED,
  APP_URL: process.env.APP_URL,
  DATABASE_URL: process.env.DATABASE_URL,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  jest.resetModules()
})

describe('AUTH_DISABLED', () => {
  test('requireValidSession resolves without touching verifyAccessTokenOrThrow', async () => {
    process.env.AUTH_DISABLED = 'true'
    delete process.env.APP_URL
    delete process.env.DATABASE_URL

    const verifyMock = jest.fn()
    jest.doMock('./utils/authUtils', () => {
      const actual = jest.requireActual('./utils/authUtils')
      return {...actual, verifyAccessTokenOrThrow: verifyMock}
    })
    jest.resetModules()

    const {createContext} = require('./trpc') as $IntentionalAny
    const ctx = await createContext({} as $IntentionalAny)
    const session = await ctx.requireValidSession({
      input: {studioAuth: {accessToken: 'x'}},
    })
    expect(session).toBeDefined()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  test('import chain survives missing APP_URL under AUTH_DISABLED', () => {
    process.env.AUTH_DISABLED = 'true'
    delete process.env.APP_URL
    delete process.env.DATABASE_URL
    jest.isolateModules(() => {
      expect(() => {
        jest.requireActual('./utils/authUtils')
        jest.requireActual('./appClient')
        jest.requireActual('./trpc')
      }).not.toThrow()
    })
  })
})

describe('auth-on (AUTH_DISABLED unset or false) still rejects token-less requests', () => {
  // The direct-ws client sends no `studioAuth` at all, so projectStateRouter
  // made the field optional. That must NOT open the door in auth-on mode:
  // requireValidSession / verifyAccessTokenOrThrow still reject. These tests
  // lock that property — the inverse of the AUTH_DISABLED bypass above.
  beforeEach(() => {
    // The AUTH_DISABLED=true tests register a doMock for ./utils/authUtils;
    // this describe needs the real module, so clear the mock + module cache.
    jest.unmock('./utils/authUtils')
    jest.resetModules()
    delete process.env.AUTH_DISABLED
    delete process.env.APP_URL
    delete process.env.DATABASE_URL
  })

  test('requireValidSession throws UNAUTHORIZED with no studioAuth when auth is on', async () => {
    const {createContext} = require('./trpc') as $IntentionalAny
    const ctx = await createContext({} as $IntentionalAny)
    // direct-ws client shape: no `studioAuth` key at all
    await expect(ctx.requireValidSession({input: {}})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  test('verifyAccessTokenOrThrow throws UNAUTHORIZED before any jwt fetch when AUTH_DISABLED=false', async () => {
    process.env.AUTH_DISABLED = 'false'
    jest.resetModules()
    const {verifyAccessTokenOrThrow} =
      require('./utils/authUtils') as $IntentionalAny
    // Rejecting with UNAUTHORIZED (rather than a fetch/network error) is the
    // proof it bailed before touching the jwt public key, which would need the
    // app (APP_URL is deleted here).
    await expect(verifyAccessTokenOrThrow({input: {}})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  // Only the exact lowercase string 'true' disables auth. A typo (uppercase,
  // '1', 'yes', trailing space, …) must be fail-closed: auth stays on and
  // token-less requests are still rejected.
  test.each(['falsee', 'TRUE', '1', 'yes', 'true '])(
    'AUTH_DISABLED=%j is fail-closed: token-less request still rejected',
    async (bad) => {
      process.env.AUTH_DISABLED = bad
      jest.resetModules()
      const {createContext} = require('./trpc') as $IntentionalAny
      const ctx = await createContext({} as $IntentionalAny)
      await expect(ctx.requireValidSession({input: {}})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    },
  )
})
