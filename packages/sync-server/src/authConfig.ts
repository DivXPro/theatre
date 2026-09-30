/**
 * Single source of truth for whether auth is disabled.
 *
 * `AUTH_DISABLED=true` = self-hosted minimal loop (no app, no postgres): the
 * sync-server lets requests through without touching the token verifier. Only
 * the exact lowercase string `'true'` disables auth — anything else stays
 * auth-on (fail-closed, see authDisabled.test.ts).
 *
 * Reads at call time rather than module load so tests that flip the env var
 * between cases (with `jest.resetModules`) see the current value.
 */
export const isAuthDisabled = (): boolean =>
  process.env.AUTH_DISABLED === 'true'
