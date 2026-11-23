# sync-server

A self-hostable state server for Theatre.js collaboration. It exposes
`@dreamerbird/saaz` through tRPC (WebSocket), so multiple browsers connected to
one server see each other's edits in real time.

## Self-hosted minimal loop (no app, no postgres)

The default `.env.example` template runs the server standalone:

```bash
cp .env.example .env
yarn cli dev start
```

- `AUTH_DISABLED=true` — the server lets requests through without access tokens,
  so no app is needed to issue JWTs.
- State is saved to JSON files under `packages/sync-server/.data` (one file per
  project namespace) and survives server restarts. Override the location with
  `SYNC_SERVER_STATE_DIR=/absolute/path`. This is single-process local
  persistence; a shared database for multi-instance deployments is future work.

Point the studio at it with a direct `ws://` url:

```js
theatre.init({studio: true, serverUrl: 'ws://localhost:3001'})
```

A `ws://`/`wss://` `serverUrl` connects straight to the sync-server, skipping
the app and client-side auth.

## App-backed mode (auth on)

The app and postgres are only needed for the authenticated, hosted path:

- `docker-compose up -d` starts the postgres database (dev only).
- Set `DATABASE_URL`, `APP_URL`, and the `DEV_DB_*` variables (see the commented
  block in `.env.example`), and leave `AUTH_DISABLED` unset/false.

## Implementation status

- [x] Expose `@dreamerbird/saaz` through tRPC.
- [x] `AUTH_DISABLED` env switch for self-hosted operation.
- [x] Persist `SaazBack`'s state locally (JSON files, atomic writes).
- [ ] Store `SaazBack`'s state in the DB for multi-instance deployments
