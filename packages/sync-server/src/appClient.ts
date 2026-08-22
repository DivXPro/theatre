import type {AppRouter} from '@toy-box/app/src/server/api/root'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import superjson from 'superjson'
import {env} from './env'

// APP_URL is optional in the env schema (AUTH_DISABLED=true needs no app).
// When auth is on it's required, so this module-level crash-on-import without
// APP_URL is acceptable for now — Task A2 replaces this with lazy init.
export let appHost = env.APP_URL as string
// if host does not start with a protocol:
if (!appHost.startsWith('http')) {
  // then assume it's https
  appHost = 'https://' + appHost
}

const appClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: appHost + '/api/trpc',
    }),
  ],
  transformer: superjson,
})

// if (process.env.NODE_ENV === 'development') {
//   void appClient..query({name: 'the lib'}).then((res) => {
//     console.log('app/healthCheck', res)
//   })
// }

export default appClient
