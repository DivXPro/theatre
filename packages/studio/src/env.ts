import type {Env} from '@toy-box/core/envSchema'
import type {$IntentionalAny} from '@toy-box/utils/types'

// process.env is guaranteed to be of type Env, because we validate it in `devEnv/cli`
export const env = process.env as $IntentionalAny as Env
