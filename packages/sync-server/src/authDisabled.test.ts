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
import type {$IntentionalAny} from '@toy-box/utils/types'

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
