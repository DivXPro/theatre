/**
 * The single source of truth for which workspaces are published to npm.
 *
 * Consumed by scripts/stable-release.mjs (tag-triggered GitHub release).
 * devEnv/cli.ts keeps its own lists for `cli build` / `prerelease ci`
 * (insiders) — changing this list does not affect those commands.
 */
export const publishablePackages = [
  '@dreamerbird/dataverse',
  '@dreamerbird/saaz',
  '@dreamerbird/core',
  '@dreamerbird/studio',
  '@dreamerbird/react',
  '@dreamerbird/r3f',
  '@dreamerbird/theatric',
  '@dreamerbird/browser-bundles',
  '@dreamerbird/camera-studio',
  '@dreamerbird/camera-studio-bridge',
]
