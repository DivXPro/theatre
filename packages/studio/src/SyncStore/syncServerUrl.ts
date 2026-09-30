// A `ws://`/`wss://` serverUrl means "connect straight to the sync-server,
// skip the app and skip client-side auth" (self-hosted minimal loop). Any
// other protocol (`http(s)://`) takes the app-backed path, where the app
// resolves the sync-server ws url and issues JWTs.
export const isDirectSyncServerUrl = (url: string): boolean =>
  url.startsWith('ws://') || url.startsWith('wss://')
