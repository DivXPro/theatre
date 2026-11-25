---
name: camera-studio-agent
description: Use when an agent needs to inspect or operate a camera-studio scene through its HTTP API, including models, assets, poses, gestures, animation strips, character paths, Fullbody IK, manga viewport, cameras, sequence keyframes, and exports.
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
- Edit clips: use `animationStrips.*`. Resolve track and strip IDs with `animationStrips.list`.
- Move a character along a curve: use `characterPaths.bind` and animate `characterPathProgress` from 0 to 100.
- Edit Fullbody IK: start a pose session, list its control points, set a world-space target, then commit or cancel.
- Set manga mode, shadows, halftone, or name labels: use `view.setRendering`, then read back `view.getRendering`.
- Import an asset: upload, `assets.importModel`, then `wait`.
- Save generated triangle meshes as a single model asset: `assets.saveModel`, then `wait`.
- Place a model: `models.create` with the ID of a saved or imported model.
- Retry a write after transport failure: reuse the original requestId.
- Read after writing. A job acceptance or resource loading state is not final success.

## Recipes and failures

Read [references/workflows.md](references/workflows.md) for end-to-end recipes and [references/errors.md](references/errors.md) for recovery rules.
