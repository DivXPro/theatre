import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const skillDir = fileURLToPath(new URL('..', import.meta.url))
const skillPath = resolve(skillDir, 'SKILL.md')
const scriptPath = resolve(skillDir, 'scripts/scene-api.mjs')
const docPaths = {
  skill: skillPath,
  workflows: resolve(skillDir, 'references/workflows.md'),
  errors: resolve(skillDir, 'references/errors.md'),
  commands: resolve(skillDir, 'references/commands.md'),
}

function readDoc(path) {
  assert.ok(existsSync(path), `missing doc: ${path}`)
  return readFileSync(path, 'utf8')
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'SKILL.md must start with a YAML frontmatter block')
  assert.ok(
    match[0].length <= 1024,
    `frontmatter block must be <= 1024 chars, got ${match[0].length}`,
  )
  const fields = {}
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    assert.ok(kv, `frontmatter line is not a simple key: value — ${line}`)
    fields[kv[1]] = kv[2]
  }
  return fields
}

function markdownLinks(content) {
  const targets = []
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g
  let match
  while ((match = linkRe.exec(content)) !== null) {
    targets.push(match[1])
  }
  return targets
}

test('SKILL.md frontmatter carries only legal name/description', () => {
  const fields = parseFrontmatter(readDoc(skillPath))
  assert.deepEqual(
    Object.keys(fields).sort(),
    ['description', 'name'],
    'frontmatter must contain exactly name and description',
  )
  assert.equal(fields.name, 'camera-studio-agent')
})

test('description states the trigger intent', () => {
  const {description} = parseFrontmatter(readDoc(skillPath))
  assert.ok(
    description.startsWith('Use when'),
    'description must start with "Use when"',
  )
  const lower = description.toLowerCase()
  for (const keyword of [
    'camera-studio',
    'http',
    'scene',
    'model',
    'camera',
    'path',
    'pose',
    'animation',
    'keyframe',
  ]) {
    assert.ok(
      lower.includes(keyword),
      `description must mention trigger keyword: ${keyword}`,
    )
  }
})

test('all relative markdown links resolve', () => {
  for (const [label, path] of Object.entries(docPaths)) {
    const content = readDoc(path)
    for (const target of markdownLinks(content)) {
      if (/^(https?:|mailto:)/.test(target)) continue
      if (target.startsWith('#')) continue
      const rel = target.split('#')[0]
      if (rel === '') continue
      assert.ok(
        existsSync(resolve(dirname(path), rel)),
        `${label}: broken relative link — ${target}`,
      )
    }
  }
})

test('every documented scene-api.mjs subcommand exists in --help', () => {
  const help = execFileSync(process.execPath, [scriptPath, '--help'], {
    encoding: 'utf8',
  })
  const valid = new Set()
  const usageRe = /^ {2}scene-api\.mjs ([a-z][a-z-]*)/gm
  let match
  while ((match = usageRe.exec(help)) !== null) {
    valid.add(match[1])
  }
  assert.ok(
    valid.size >= 8,
    `expected at least 8 subcommands in --help, got: ${[...valid].join(', ')}`,
  )
  for (const [label, path] of Object.entries(docPaths)) {
    const content = readDoc(path)
    const mentionRe = /scene-api\.mjs\s+([a-z][a-z-]*)/g
    while ((match = mentionRe.exec(content)) !== null) {
      assert.ok(
        valid.has(match[1]),
        `${label}: unknown subcommand "${match[1]}" (not in --help)`,
      )
    }
  }
})

test('objects.update decision precedes the first keyframes.set example', () => {
  for (const label of ['skill', 'workflows']) {
    const content = readDoc(docPaths[label])
    const updateIdx = content.indexOf('objects.update')
    const keyframesIdx = content.indexOf('keyframes.set')
    assert.notEqual(
      updateIdx,
      -1,
      `${label}: static-vs-keyframe decision rule (objects.update) is missing`,
    )
    if (keyframesIdx !== -1) {
      assert.ok(
        updateIdx < keyframesIdx,
        `${label}: objects.update decision must appear before the first keyframes.set example`,
      )
    }
  }
})

test('docs carry no real tokens, eval(, or placeholder debt', () => {
  for (const [label, path] of Object.entries(docPaths)) {
    const content = readDoc(path)
    assert.ok(
      !/Bearer\s+[A-Za-z0-9_\-.]{8,}/.test(content),
      `${label}: looks like a real Bearer token value`,
    )
    assert.ok(!/eval\(/.test(content), `${label}: contains eval(`)
    assert.ok(!/\bTODO\b/.test(content), `${label}: contains TODO`)
  }
})
