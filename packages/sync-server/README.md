# sync-server

A self-hostable state server for Theatre.js collaboration. It exposes
`@toy-box/saaz` through tRPC (WebSocket), so multiple browsers connected to
one server see each other's edits in real time.

## Self-hosted minimal loop (no app, no postgres)

The default `.env.example` template runs the server standalone:

```bash
cp .env.example .env
yarn cli dev start
```

- `AUTH_DISABLED=true` — the server lets requests through without access
  tokens, so no app is needed to issue JWTs.
- State lives in memory (`BackMemoryAdapter`): **it is lost on restart**.
  Postgres-backed persistence is future work.

Point the studio at it with a direct `ws://` url:

```js
theatre.init({studio: true, serverUrl: 'ws://localhost:3001'})
```

A `ws://`/`wss://` `serverUrl` connects straight to the sync-server, skipping
the app and client-side auth.

## App-backed mode (auth on)

The app and postgres are only needed for the authenticated, hosted path:

- `docker-compose up -d` starts the postgres database (dev only).
- Set `DATABASE_URL`, `APP_URL`, and the `DEV_DB_*` variables (see the
  commented block in `.env.example`), and leave `AUTH_DISABLED` unset/false.

## Implementation status

- [x] Expose `@toy-box/saaz` through tRPC.
- [x] `AUTH_DISABLED` env switch for self-hosted operation.
- [ ] Store `SaazBack`'s state in the DB
