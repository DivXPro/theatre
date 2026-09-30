import {z} from 'zod'
import {createRouter, procedure} from '..'
import {getSaazBack} from '../../saaz'
import {observable} from '@trpc/server/observable'

// In the self-hosted minimal loop (AUTH_DISABLED=true) the direct-ws client
// sends no token at all, so studioAuth is optional. requireValidSession
// handles the missing token (lets it through when auth is disabled, rejects
// otherwise). The app-backed (auth-on) client always supplies it.
const studioAuth = z.object({accessToken: z.string()}).optional()

// type Session = {
//   _accessToken: string
// }

// export async function ensureSessionHasAccessToProject(
//   session: Session,
//   projectId: string,
// ) {
//   const {canEdit} = await appClient.studioAuth.canIEditProject.query({
//     studioAuth: {accessToken: session._accessToken},
//     projectId,
//   })
//   return canEdit
// }

export const projectState = createRouter({
  saaz_applyUpdates: procedure
    .input(z.object({dbName: z.string(), opts: z.any(), studioAuth}))
    .output(z.any())
    .mutation(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return getSaazBack(opts.input.dbName).applyUpdates(opts.input.opts)
    }),

  saaz_updatePresence: procedure
    .input(z.object({dbName: z.string(), opts: z.any(), studioAuth}))
    .output(z.any())
    .mutation(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return getSaazBack(opts.input.dbName).updatePresence(opts.input.opts)
    }),

  saaz_closePeer: procedure
    .input(
      z.object({
        dbName: z.string(),
        opts: z.object({peerId: z.string()}),
        studioAuth,
      }),
    )
    .output(z.any())
    .mutation(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return getSaazBack(opts.input.dbName).closePeer(opts.input.opts)
    }),

  saaz_getUpdatesSinceClock: procedure
    .input(z.object({dbName: z.string(), opts: z.any(), studioAuth}))
    .output(z.any())
    .query(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return getSaazBack(opts.input.dbName).getUpdatesSinceClock(
        opts.input.opts,
      )
    }),

  saaz_getLastIncorporatedPeerClock: procedure
    .input(
      z.object({
        dbName: z.string(),
        opts: z.object({peerId: z.string()}),
        studioAuth,
      }),
    )
    .output(z.any())
    .query(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return getSaazBack(opts.input.dbName).getLastIncorporatedPeerClock(
        opts.input.opts,
      )
    }),

  saaz_subscribe: procedure
    .input(z.object({dbName: z.string(), opts: z.any(), studioAuth}))
    .output(z.any())
    .subscription(async (opts) => {
      await opts.ctx.requireValidSession(opts)
      return observable<{}>((emit) => {
        const unsubPromise = getSaazBack(opts.input.dbName).subscribe(
          opts.input.opts,
          (s) => {
            emit.next(s)
          },
        )

        return () => {
          void unsubPromise.then((unsub) => unsub())
        }
      })
    }),
})
