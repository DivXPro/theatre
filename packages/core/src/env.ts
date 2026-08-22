import type {Env} from './envSchema'

// process.env is guaranteed to be of type Env, because we validate it in the `devEnv` scripts.
//
// NB: read each key individually. Build tools (Vite's `define`, esbuild's
// `define` in packages/*/devEnv) replace `process.env.<KEY>` with its literal
// value at build time, but a bare `process.env` reference survives the replace
// pass and crashes browser bundles, where `process` is undefined. Reading the
// whole object here previously crashed the playground and studio browser builds.
export const env: Env = {
  BUILT_FOR_PLAYGROUND: process.env
    .BUILT_FOR_PLAYGROUND as Env['BUILT_FOR_PLAYGROUND'],
  THEATRE_VERSION: process.env.THEATRE_VERSION as Env['THEATRE_VERSION'],
  BACKEND_URL: process.env.BACKEND_URL as Env['BACKEND_URL'],
}
