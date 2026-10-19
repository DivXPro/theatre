# Camera Studio Agent Workflows

End-to-end recipes over `scripts/scene-api.mjs`. Every example runs from the repository root; if your current directory differs, resolve the skill directory and use the script's absolute path.

General rules for every recipe:

- stdout is JSON only; a failure prints `{ok:false,error:{code,message,retryable,...}}` to stderr and exits non-zero. Check the exit code before parsing stdout.
- Placeholders like `<fileId>` come from earlier command output — never invent IDs. Typed scene IDs carry prefixes: `model:`, `camera:`, `anchor:`, `path:`.
- `accepted` is not success: job commands return `{jobId}` immediately. Always `wait` to a terminal state and then verify by reading.
- Mutations that take `expectedRevision` chain revisions: use the `revision` returned by your last read (`scene.getSnapshot`) or write, and re-read on `REVISION_CONFLICT`.
- Decide before writing: a static change is `objects.update`; animation over time is `keyframes.set`. Do not write keyframes for a value that never changes over time, and do not use `objects.update` to fake animation.

## 1. Import a GLB and place the model

Goal: upload a model file, import it into the asset library, place it in the scene, verify it is mounted.

Prerequisite reads: `health` (scene connected), then `scene.getSnapshot` for the current revision.

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs health
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call scene.getSnapshot '{}'
```

Commands:

```bash
# 1. Upload the file -> {"fileId","fileName","mimeType","size"}
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs upload ./robot.glb --mime model/gltf-binary

# 2. Start the import job -> {"jobId"}
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call assets.importModel \
  '{"file":{"fileId":"<fileId>","fileName":"robot.glb","mimeType":"model/gltf-binary"}}'

# 3. Wait for the terminal state; on success result.id is the asset entry id
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs wait <jobId> --timeout-ms 120000

# 4. Place the model (use the revision from your snapshot read)
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call models.create \
  '{"assetId":"<assetId>","position":{"x":0,"y":0,"z":0},"expectedRevision":<revision>}'

# 5. Verify by reading back
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.get \
  '{"objectId":"<model:...>"}'
```

Verify: step 5 returns `mounted: true` and `props` reflects the requested position.

Stop when: upload fails (fix the path/mime, do not continue); `wait` exits non-zero (read the job `error` from stderr, do not place the model); `models.create` returns `REVISION_CONFLICT` (re-read the snapshot and retry once with the fresh revision); `models.create` returns `RESOURCE_LOAD_FAILED` (the imported data is unusable — stop, do not retry blindly).

## 2. Pose, gesture, and animation

Goal: put a placed model into a library pose with a hand gesture, then start an animation and confirm it actually loaded.

Prerequisite reads:

```bash
# find the model's typed object id
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.list '{}'
# body poses and hand gestures are both pose-kind entries; pick by name
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call assets.list '{"kind":"pose"}'
# animation entries
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call assets.list '{"kind":"animation"}'
```

Commands (chain `expectedRevision` from each response):

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call poses.apply \
  '{"objectId":"<model:...>","assetId":"<poseAssetId>","expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call poses.setGesture \
  '{"objectId":"<model:...>","side":"left","assetId":"<gestureAssetId>","expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call animations.apply \
  '{"objectId":"<model:...>","assetId":"<animationAssetId>","expectedRevision":<revision>}'

# resource loading is asynchronous — committed does not mean loaded
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call animations.getStatus \
  '{"objectId":"<model:...>"}'
```

Verify: `animations.getStatus` returns `loaded: true` with the applied `assetId`.

Stop when: any call returns `OBJECT_NOT_FOUND` or `ASSET_NOT_FOUND` (re-list — state changed; do not reuse stale IDs); `animations.getStatus` carries an `error` (see [errors.md](errors.md) `RESOURCE_LOAD_FAILED`); `INVALID_STATE` on `poses.setGesture` (the gesture property is already sequenced on the timeline — read the object before deciding how to proceed).

## 3. Camera bound to a preset path

Goal: create a camera, lay down a preset camera path, bind them, and sample the path.

Prerequisite reads: `scene.getSnapshot` (revision), `paths.listPresets` (valid preset ids — never guess one).

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call scene.getSnapshot '{}'
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call paths.listPresets '{}'
```

Commands:

```bash
# seed from the current director view, or pass an explicit transform instead
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call cameras.create \
  '{"fromCurrentView":true,"expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call paths.createPreset \
  '{"preset":"<presetId>","at":{"x":0,"y":1.6,"z":0},"expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call cameras.bindPath \
  '{"objectId":"<camera:...>","pathId":"<path:...>","expectedRevision":<revision>}'

# verify: u is overall progress 0..1
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call paths.sample \
  '{"pathId":"<path:...>","u":0.5}'
```

Verify: `paths.sample` returns a finite `position`; `objects.get` on the camera shows the binding in its props.

Stop when: `paths.createPreset` returns `INVALID_ARGUMENT` (the preset id is unknown — re-run `paths.listPresets`); any `REVISION_CONFLICT` (re-read and retry with the fresh revision); `OBJECT_NOT_FOUND` on bind (re-list objects — the camera or path id is stale).

## 4. Sequence length and keyframes

Goal: set the sequence length, write two keyframes on a model's x position, seek, and verify.

Reminder: this recipe is for values that change over time. For a one-off static change use `objects.update` instead — writing keyframes for static values pollutes the timeline.

Prerequisite reads: `sequence.getState` (current length/position), `scene.getSnapshot` (revision), `objects.get` on the target (current prop values).

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call sequence.getState '{}'
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.get '{"objectId":"<model:...>"}'
```

Commands:

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call sequence.setLength \
  '{"length":10,"expectedRevision":<revision>}'

# propPath addresses a simple leaf prop, segment by segment
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call keyframes.set \
  '{"objectId":"<model:...>","propPath":["position","x"],"at":2,"value":5,"expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call keyframes.set \
  '{"objectId":"<model:...>","propPath":["position","x"],"at":6,"value":-5,"expectedRevision":<revision>}'

node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call sequence.seek '{"position":2}'
```

Verify:

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call keyframes.list \
  '{"objectId":"<model:...>","propPath":["position","x"]}'
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.get '{"objectId":"<model:...>"}'
```

`keyframes.list` shows both frames at positions 2 and 6; after the seek, `objects.get` shows the evaluated `position.x` at the playhead.

Stop when: `keyframes.set` returns `INVALID_ARGUMENT` (the propPath is not a simple leaf — check the object's props and address one scalar leaf per call); `OBJECT_NOT_FOUND` (re-list); `REVISION_CONFLICT` (re-read, retry).

## 5. Export video and download the result

Goal: render the sequence from a camera and save the file locally.

Prerequisite reads: confirm the camera exists (`objects.list`) and make it active (or pass `cameraId` explicitly).

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call cameras.setActive \
  '{"objectId":"<camera:...>"}'
```

Commands:

```bash
# starts a job -> {"jobId"}
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call exports.startVideo \
  '{"cameraId":"<camera:...>"}'

# rendering takes time — give wait a generous timeout
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs wait <jobId> --timeout-ms 600000

# on success the job result carries {"fileId","fileName","mimeType","size"}
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs download <fileId> ./scene-export.mp4
```

Verify: `download` prints `{fileId, output, size}` and the local file's `size` equals the job result's `size`.

Stop when: `exports.startVideo` returns `CAPABILITY_UNAVAILABLE` (the host cannot encode — report to the user; do not retry); the job ends `failed` or `cancelled` (read the job `error`, then stop); `download` exits with `FILE_EXISTS` (client-side safeguard — pick another output name, or pass `--force` only when overwriting is intended); `FILE_NOT_FOUND` on download (the bridge-side temp file expired — re-export).

## 6. Revision conflicts and safe retries

Goal: recover from a lost update race and from an uncertain transport failure, without corrupting state.

### 6a. expectedRevision conflict

```bash
# you read revision 12, someone else writes first, your write loses the race
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.update \
  '{"objectId":"<model:...>","props":{"position":{"x":1,"y":0,"z":0}},"expectedRevision":12}'
# -> stderr {"ok":false,"error":{"code":"REVISION_CONFLICT",...}}, non-zero exit
```

Recovery:

1. Re-read the object (`objects.get`) or the whole scene (`scene.getSnapshot`) and note the new revision.
2. Re-decide from the fresh props — the other writer's change may alter your intent.
3. Retry with the fresh `expectedRevision`.

Never drop `expectedRevision` to force the write through — that silently overwrites the other change. Compound props must be sent as complete values; merge against the freshly read props, not against your stale copy.

### 6b. Safe retry with the same requestId

A write that fails in transport (`NETWORK_ERROR`, timeout) may or may not have been applied. Pass an explicit requestId on the first attempt so a retry can reuse it:

```bash
# first attempt — generate the id yourself and keep it
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.update \
  '{"objectId":"<model:...>","props":{"position":{"x":1,"y":0,"z":0}},"expectedRevision":<revision>}' \
  --request-id 7f3c1a2e-4d5b-4c6a-9e8f-1a2b3c4d5e6f

# transport failure -> retry the exact same call with the same requestId
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs call objects.update \
  '{"objectId":"<model:...>","props":{"position":{"x":1,"y":0,"z":0}},"expectedRevision":<revision>}' \
  --request-id 7f3c1a2e-4d5b-4c6a-9e8f-1a2b3c4d5e6f
```

The bridge deduplicates by requestId: the retry returns the original result instead of applying the write twice. Never generate a fresh requestId for a retry — that is a new write. If the first attempt got a definitive domain answer (a non-`retryable` error), do not retry at all; handle the error per [errors.md](errors.md).
