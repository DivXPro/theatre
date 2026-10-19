#!/usr/bin/env node
/**
 * Stable release publisher — publishes every publishable workspace whose
 * package.json version does not yet exist on npm.
 *
 * Triggered by the release.yml GitHub workflow on `v*` tags, but runnable
 * locally for inspection:
 *
 *   node scripts/stable-release.mjs --dry-run            # what would publish?
 *   node scripts/stable-release.mjs --dry-run --tag v0.2.0
 *
 * Idempotent by design: versions already on npm are skipped, so re-running
 * a failed release only attempts the packages that did not make it.
 *
 * Auth: in CI the token comes from `.github/.yarnrc.publish.yml` +
 * NODE_AUTH_TOKEN (appended to .yarnrc.yml by the workflow). The token is
 * never printed.
 */
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {publishablePackages} from './publishablePackages.mjs'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const tagArg = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : undefined
const tag = tagArg ?? process.env.GITHUB_REF_NAME

function readPackageVersion(workspaceName) {
  const short = workspaceName.replace('@dreamerbird/', '')
  const manifestPath = join(repoRoot, 'packages', short, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.private) {
    throw new Error(
      `${workspaceName} is marked private:true — remove the flag to publish`,
    )
  }
  return manifest.version
}

/** Returns true if name@version already exists on the registry. */
function existsOnRegistry(name, version) {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, NODE_AUTH_TOKEN: ''},
    })
    return true
  } catch {
    return false
  }
}

function fail(message) {
  console.error(JSON.stringify({ok: false, error: message}))
  process.exit(1)
}

// --- tag validation -------------------------------------------------------
// A `v*` tag must correspond to at least one publishable package's version,
// otherwise the tag is almost certainly a typo.
const versions = publishablePackages.map((name) => ({
  name,
  version: readPackageVersion(name),
}))

if (tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail(`Release tag "${tag}" must look like v1.2.3`)
  }
  const taggedVersion = tag.slice(1)
  if (!versions.some((p) => p.version === taggedVersion)) {
    fail(
      `Tag ${tag} does not match any publishable package version: ` +
        versions.map((p) => `${p.name}@${p.version}`).join(', '),
    )
  }
}

// --- resolve what to publish ---------------------------------------------
const plan = versions.map((p) => ({
  ...p,
  alreadyPublished: existsOnRegistry(p.name, p.version),
}))
const todo = plan.filter((p) => !p.alreadyPublished)

console.log(
  JSON.stringify(
    {
      tag: tag ?? null,
      dryRun,
      skipping: plan
        .filter((p) => p.alreadyPublished)
        .map((p) => `${p.name}@${p.version}`),
      publishing: todo.map((p) => `${p.name}@${p.version}`),
    },
    null,
    2,
  ),
)

if (todo.length === 0) {
  console.log('Nothing to publish — every version already exists on npm.')
  process.exit(0)
}

if (dryRun) process.exit(0)

// --- publish ---------------------------------------------------------------
// 各包 prepublish 钩子(devEnv/ensurePublishing.js)只认这个哨兵变量,
// 与 devEnv/cli.ts 的 release/prerelease 通道同一约定。
const publishEnv = {...process.env, THEATRE_IS_PUBLISHING: 'true'}
const published = []
for (const p of todo) {
  console.log(`Publishing ${p.name}@${p.version} …`)
  try {
    execFileSync(
      'yarn',
      [
        'workspace',
        p.name,
        'npm',
        'publish',
        '--access',
        'public',
        '--tag',
        'latest',
      ],
      {cwd: repoRoot, stdio: 'inherit', env: publishEnv},
    )
  } catch {
    fail(
      `Failed to publish ${p.name}@${p.version}. ` +
        `Already published in this run: ${published.join(', ') || '(none)'}. ` +
        `Fix the issue and re-run — published versions are skipped.`,
    )
  }
  published.push(`${p.name}@${p.version}`)
}

// GitHub Actions step output + summary
if (process.env.GITHUB_OUTPUT) {
  const {appendFileSync} = await import('node:fs')
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `data=${JSON.stringify(published)}\n`,
  )
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const {appendFileSync} = await import('node:fs')
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Published to npm\n\n${published.map((p) => `- \`${p}\``).join('\n')}\n`,
  )
}

console.log(JSON.stringify({ok: true, published}))
