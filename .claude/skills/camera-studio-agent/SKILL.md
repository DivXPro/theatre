---
name: camera-studio-agent
description: Use when an agent needs to inspect or operate a camera-studio scene through its HTTP API, including models, assets, poses, gestures, animations, cameras, anchors, paths, sequence keyframes, and video export.
---

# Camera Studio Agent

Use `scripts/scene-api.mjs` for every scene operation. Do not click Studio DOM controls or guess object IDs.

All examples run from the repository root. If your current directory differs, resolve the skill's own directory first and invoke the script by absolute path. stdout is machine-readable JSON only; errors go to stderr as a JSON envelope with a non-zero exit code.

## Setup

Require `CAMERA_STUDIO_API_URL` and `CAMERA_STUDIO_TOKEN` from the deployer. The token is read from the environment only — never print it, never write it into files or logs.

1. Run `health` and confirm the scene is connected.
2. Run `schema` and read [references/commands.md](references/commands.md) for detailed DTOs.
3. Run `call scene.getSnapshot '{}'` and use the returned typed IDs (`model:`, `camera:`, `anchor:`, `path:` prefixes) — never invent IDs.

## Decide before writing

- Change a static object: `objects.update`.
- Animate a property over time: `keyframes.set`.
- Import an asset: upload, `assets.importModel`, then `wait`.
- Place a model: `models.create` after import resolves successfully.
- Retry a write after transport failure: reuse the original requestId.
- Read after writing. A job acceptance or resource loading state is not final success.

## Recipes and failures

Read [references/workflows.md](references/workflows.md) for end-to-end recipes and [references/errors.md](references/errors.md) for recovery rules.
