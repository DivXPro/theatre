import z from 'zod'

// the env variables that are only required in development
const devOnly = z.object({
  DEV_DB_PORT: z.string().optional(),
  DEV_DB_PASSWORD: z.string().optional(),
})

// the env variables that both development and production require
// DATABASE_URL/APP_URL/DEV_DB_* are optional here — they're only mandatory
// when auth is enabled (AUTH_DISABLED !== 'true'), enforced by
// requireAppWhenAuth below.
const baseSchema = z.object({
  PORT: z.string().regex(/^\d+$/),
  HOST: z.string(),
  AUTH_DISABLED: z.enum(['true', 'false']).optional(),
  DATABASE_URL: z.string().optional(),
  APP_URL: z
    .string()
    .url()
    .optional()
    .describe(
      `the url to the app, like 'http://localhost:3000'. If the protocol is omitted,` +
        ` then https is assumed. If the port is omitted, then 80 is assumed.`,
    ),
})

// shape of the fields `requireAppWhenAuth` validates, shared by dev & prod
type AppAuthEnv = {
  NODE_ENV?: string
  AUTH_DISABLED?: string
  DATABASE_URL?: string
  APP_URL?: string
  DEV_DB_PORT?: string
  DEV_DB_PASSWORD?: string
}

// AUTH_DISABLED=true = self-hosted minimal loop (no app, no postgres).
// Otherwise the app + its DB are mandatory.
function requireAppWhenAuth(data: AppAuthEnv, ctx: z.RefinementCtx) {
  if (data.AUTH_DISABLED === 'true') return
  if (!data.DATABASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'Required when AUTH_DISABLED is not true',
    })
  }
  if (!data.APP_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_URL'],
      message: 'Required when AUTH_DISABLED is not true',
    })
  }
  // dev-only: DEV_DB_* compose DATABASE_URL in dev (see devEnv/cli.ts). They
  // stay `.optional()` at the schema level like the rest, but are enforced
  // here so a dev running auth-on without them gets a clear error instead of a
  // confusing `postgresql://postgres:undefined@…` mismatch downstream. Mirrors
  // the app's envSchema, where DEV_DB_* are mandatory.
  if (data.NODE_ENV === 'development') {
    if (!data.DEV_DB_PORT) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_DB_PORT'],
        message: 'Required in development when AUTH_DISABLED is not true',
      })
    }
    if (!data.DEV_DB_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_DB_PASSWORD'],
        message: 'Required in development when AUTH_DISABLED is not true',
      })
    }
  }
}

// the env variables that are required in development (devOnly + baseSchema)
export const devSchema = baseSchema
  .extend({
    NODE_ENV: z.literal('development'),
  })
  .merge(devOnly)
  .superRefine(requireAppWhenAuth)

// the env variables that are only required in production
const productionOnly = z.object({})

// the env variables that are required in production (productionOnly + baseSchema)
export const productionSchema = baseSchema
  .extend({
    NODE_ENV: z.literal('production'),
  })
  .merge(productionOnly)
  .superRefine(requireAppWhenAuth)

// the env variables that are required in both development and production
export const fullSchema = z.union([productionSchema, devSchema])

// shape-preserving production schema, for tooling that enumerates keys
// (e.g. the render.yaml test) — superRefine above turns the schema into a
// ZodEffects which has no `.shape`.
export const productionSchemaShape = baseSchema
  .extend({
    NODE_ENV: z.literal('production'),
  })
  .merge(productionOnly)

export type Env = z.infer<typeof fullSchema>
