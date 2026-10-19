# Camera Studio Agent Errors

How failures arrive and what to do next. Every failure — domain or transport — reaches you the same way: a JSON envelope on stderr and a non-zero exit code:

```json
{"ok": false, "error": {"code": "REVISION_CONFLICT", "message": "...", "retryable": false}}
```

Exit code 2 means a local usage problem (`USAGE`, invalid flag, missing env var); exit code 1 is everything else. Decide from `error.code` and `error.retryable` — never blanket-retry every failure.

## Lifecycle: not ready, disposed, no scene

`API_NOT_READY`, `API_DISPOSED`, `SCENE_UNAVAILABLE`

1. Run `node .claude/skills/camera-studio-agent/scripts/scene-api.mjs health`.
2. `scene: "connected"` means the Studio page is attached; `scene: "unavailable"` means no page is connected — wait and re-check, or ask the deployer to open/refresh the Studio page.
3. `API_DISPOSED` means the page was torn down mid-session: abandon in-flight assumptions, re-run `health` until a fresh scene connects, then re-read state (`scene.getSnapshot`) before any write. Old command results and job outcomes are not trustworthy across a dispose.

## Contract: unknown command, missing capability

`COMMAND_NOT_FOUND`, `CAPABILITY_UNAVAILABLE`

- Re-fetch `schema` (or check [commands.md](commands.md)) and use a command the runtime actually declares — never guess command names or argument shapes.
- `CAPABILITY_UNAVAILABLE` (for example a host that cannot encode video) is a property of the deployment, not a transient fault: stop and report; retrying cannot fix it.

## Arguments and IDs

`INVALID_ARGUMENT`, `INVALID_ID_KIND`

- Fix the call against the command's schema in [commands.md](commands.md): compound props need complete values, `propPath` is an array of segments, `additionalProperties` is closed — extra fields are rejected.
- Scene IDs are typed (`model:`, `camera:`, `anchor:`, `path:`). `INVALID_ID_KIND` means the ID's prefix does not match what the command expects — re-read `objects.list` and take the ID verbatim.

## Not found

`OBJECT_NOT_FOUND`, `ASSET_NOT_FOUND`, `PATH_POINT_NOT_FOUND`, `KEYFRAME_NOT_FOUND`, `JOB_NOT_FOUND`, `FILE_NOT_FOUND`

- Re-list before anything else: `objects.list`, `assets.list`, `jobs.get`. Scene state changes under you; an ID from an earlier read may be gone.
- `FILE_NOT_FOUND` on download means the bridge-side temp file expired — re-run the producing command (`exports.startVideo`, upload) instead of retrying the download.

## Concurrency

`REVISION_CONFLICT`

- Re-read the object or snapshot, re-decide from fresh props, retry with the new `expectedRevision`. See [workflows.md](workflows.md) recipe 6a. Never drop `expectedRevision` to force the write.

## State preconditions

`INVALID_STATE`

- A precondition failed (pose session in progress, property already sequenced, path editing state, and so on). Read the relevant state — `objects.get`, `animations.getStatus`, `sequence.getState` — to learn which precondition, then either satisfy it or stop. Retrying the identical call cannot help.

## Jobs

`JOB_NOT_CANCELABLE`, `JOB_CANCELLED`

- Poll with `wait` (or `job`) until a terminal state: `succeeded`, `failed`, `cancelled`. `accepted`/`running` are not outcomes.
- A `failed` job carries a structured `error` in its snapshot — read it (`job <jobId>`) and stop; do not re-issue the same job until the cause is addressed.
- `JOB_NOT_CANCELABLE` means the job is past the point where cancellation applies — let it finish and read the result.

## Auth and origin

`UNAUTHORIZED`, `FORBIDDEN`

- Token, CORS whitelist, and listen address are deployer configuration. Hand the failure back to the deployer — never try to bypass: no origin spoofing, no scanning for tokens, no downgrading to another endpoint.
- The token comes only from `CAMERA_STUDIO_TOKEN`; the CLI attaches the authorization header itself. Never print the token, and never write it into files, logs, or command output.

## Transport, storage, and resource limits

`NETWORK_ERROR`, `STORAGE_ERROR`, `RESOURCE_LOAD_FAILED`, `PAYLOAD_TOO_LARGE`

- Honor `retryable`. A `NETWORK_ERROR` marked retryable may be retried — for writes, only with the original requestId (see [workflows.md](workflows.md) recipe 6b); queries are safe to retry directly.
- `RESOURCE_LOAD_FAILED` means asset data could not be decoded or loaded (model mount, animation clip). Pick another asset or re-import; the failure is in the data, not in transient state.
- `PAYLOAD_TOO_LARGE` is a deployer-tuned limit on commands and uploads — compress or split the payload, or ask the deployer to raise the limit. Retrying the same bytes cannot succeed.

## Partial and internal failures

`PARTIAL_FAILURE`, `INTERNAL_ERROR`

- `PARTIAL_FAILURE` `details` list what completed, what failed, and any asset or object IDs already created. Continue or clean up from those IDs — do not blindly re-run the whole command, and do not assume nothing happened.
- `INTERNAL_ERROR`: capture the requestId you sent and report it to the deployer with the error envelope. Treat as not retryable unless `retryable` says otherwise.

## Asset operations do not undo

`assets.delete`, `assets.rename`, `assets.importModel`, and `poses.saveCurrent` are `Undoable: none` — they bypass Theatre history. `history.undo` does not roll them back. Confirm before destructive asset operations, and recover from mistakes by re-importing or re-creating, not by undo.

## Client-side CLI codes

These originate in `scene-api.mjs` itself, never from the bridge:

- `USAGE` (exit 2): malformed invocation — wrong flags, missing positional args, args that are not valid JSON. Fix the command line.
- `FILE_EXISTS`: **client-side only** — the bridge never emits it. `download` refuses to overwrite an existing local file. Choose another output path, or pass `--force` only when overwriting is deliberate.
- `CLI_ERROR`: a local filesystem or runtime failure (cannot write output, unexpected exception). Inspect the message; the scene state is untouched.

## Error details hygiene

The CLI passes the server's error `details` through to stderr verbatim. The bridge never includes HTTP headers in errors, but `details` can carry server-side messages or paths — inspect them before pasting into shared logs or public channels.

## Maintainer note: running the skill tests

On Node 24, pass the test files as a glob — a directory argument is broken:

```bash
node --test .claude/skills/camera-studio-agent/tests/*.test.mjs
```
