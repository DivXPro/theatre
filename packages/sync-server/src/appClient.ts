import type {AppRouter} from '@toy-box/app/src/server/api/root'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import superjson from 'superjson'
import {env} from './env'

// APP_URL is optional (AUTH_DISABLED=true needs no app). When it's absent,
// appClient is null and authUtils never fetches the jwt public key — the
// self-hosted minimal loop has no app to talk to.
const rawAppUrl = env.APP_URL
export let appHost = ''
if (typeof rawAppUrl === 'string' && rawAppUrl !== '') {
  // if host does not start with a protocol, assume https
  appHost = rawAppUrl.startsWith('http') ? rawAppUrl : 'https://' + rawAppUrl
}

const appClient = appHost
  ? createTRPCProxyClient<AppRouter>({
      links: [
        httpBatchLink({
          url: appHost + '/api/trpc',
        }),
      ],
      transformer: superjson,
    })
  : null

// if (process.env.NODE_ENV === 'development') {
//   void appClient?.query({name: 'the lib'}).then((res) => {
//     console.log('app/healthCheck', res)
//   })
// }

export default appClient
