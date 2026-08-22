import type {SyncServerRootRouter} from '@toy-box/sync-server/trpc/routes'
import superjson from 'superjson'
import type {CreateTRPCProxyClient} from '@trpc/client'
import {
  createTRPCProxyClient,
  createWSClient,
  loggerLink,
  wsLink,
} from '@trpc/client'

export type SyncServerConnectionState = 'connected' | 'reconnecting'

export default class SyncServerLink {
  private _client: CreateTRPCProxyClient<SyncServerRootRouter> | undefined
  private _wsClient: ReturnType<typeof createWSClient>

  constructor(
    private _url: string,
    // `createWSClientImpl` is injectable for tests (jest maps @trpc/client to
    // identity-obj-proxy, so the real factory isn't callable there).
    opts: {createWSClientImpl?: typeof createWSClient} = {},
  ) {
    const createWSClientImpl = opts.createWSClientImpl ?? createWSClient
    this._wsClient = createWSClientImpl({url: _url})

    if (process.env.NODE_ENV === 'development') {
      void this.api.healthcheck.query({}).then((res) => {
        console.log('syncServer/healthCheck', res)
      })
    }
  }

  get api(): CreateTRPCProxyClient<SyncServerRootRouter> {
    // Built lazily on first access: the constructor only touches the ws client,
    // so tests can construct the link without a real tRPC client. Production
    // resolves `.api` (createTrpcBackend) before any backend operation.
    if (!this._client) {
      this._client = createTRPCProxyClient<SyncServerRootRouter>({
        links: [
          loggerLink({
            console: {
              log: (arg0, ...rest) =>
                console.info('SyncServerLink ' + arg0, ...rest),
              error: (arg0, ...rest) =>
                console.error('SyncServerLink ' + arg0, ...rest),
            },
            enabled: (opts) =>
              (process.env.NODE_ENV === 'development' &&
                typeof window !== 'undefined') ||
              (opts.direction === 'down' && opts.result instanceof Error),
          }),
          wsLink({client: this._wsClient}),
        ],
        transformer: superjson,
      })
    }
    return this._client
  }

  /**
   * Emits the current connection state immediately, then every 1s. tRPC's
   * ws client reconnects by creating a NEW WebSocket, so polling
   * `getConnection()` each tick always reads the live socket's readyState
   * (OPEN = connected, everything else = reconnecting). Returns an unsub.
   */
  onConnectionStateChange(
    cb: (state: SyncServerConnectionState) => void,
  ): () => void {
    const emit = () => {
      const ws = this._wsClient.getConnection()
      const state: SyncServerConnectionState =
        ws?.readyState === 1 ? 'connected' : 'reconnecting'
      cb(state)
    }
    emit()
    const iv = setInterval(emit, 1000)
    return () => clearInterval(iv)
  }
}
