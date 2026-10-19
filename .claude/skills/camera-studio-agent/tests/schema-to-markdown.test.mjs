import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const script = fileURLToPath(
  new URL('../scripts/schema-to-markdown.mjs', import.meta.url),
)

/**
 * 运行转换器:stdin 喂 JSON,收集 stdout/stderr 与退出码。
 * 与场景用法一致:`scene-api.mjs schema | schema-to-markdown.mjs`。
 */
function runConverter(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {...process.env},
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({code, stdout, stderr}))
    child.stdin.write(input)
    child.stdin.end()
  })
}

/**
 * 与运行时 registry.describe() 同形的 schema(registry.ts
 * CommandDescription 字段名一字不差),故意乱序登记以验证按名排序;
 * validate/execute 函数不得进入 Markdown。
 */
const SCHEMA = {
  apiVersion: 1,
  commands: [
    {
      name: 'exports.startVideo',
      kind: 'job',
      stateDomain: 'project',
      undoable: 'none',
      completion: 'loaded',
      cancelable: true,
      inputSchema: {
        type: 'object',
        properties: {cameraId: {type: 'string'}},
      },
      outputSchema: {
        type: 'object',
        properties: {jobId: {type: 'string'}},
      },
      jobResultSchema: {
        type: 'object',
        properties: {fileId: {type: 'string'}},
      },
      errorCodes: ['JOB_NOT_CANCELABLE', 'INTERNAL_ERROR'],
      acceptsExpectedRevision: false,
      validate: () => true,
      execute: async () => ({}),
    },
    {
      name: 'objects.update',
      kind: 'mutation',
      stateDomain: 'project',
      undoable: 'single-step',
      completion: 'committed',
      inputSchema: {
        type: 'object',
        properties: {objectId: {type: 'string'}},
      },
      outputSchema: {type: 'object', properties: {revision: {type: 'number'}}},
      errorCodes: ['INVALID_ARGUMENT', 'OBJECT_NOT_FOUND', 'REVISION_CONFLICT'],
      acceptsExpectedRevision: true,
    },
    {
      name: 'scene.getSnapshot',
      kind: 'query',
      stateDomain: 'project',
      undoable: 'none',
      inputSchema: {type: 'object'},
      outputSchema: {type: 'object', properties: {objects: {type: 'array'}}},
      errorCodes: [],
      acceptsExpectedRevision: false,
    },
  ],
}

function sectionOf(markdown, name) {
  const start = markdown.indexOf(`## \`${name}\``)
  assert.notEqual(start, -1, `missing section: ${name}`)
  const rest = markdown.slice(start + 1)
  const next = rest.indexOf('\n## `')
  return next === -1 ? markdown.slice(start) : markdown.slice(start, start + 1 + next)
}

test('converts schema to sorted markdown with full metadata', async () => {
  const {code, stdout} = await runConverter(JSON.stringify(SCHEMA))
  assert.equal(code, 0)

  // 头部:生成器署名 + apiVersion,无时间戳。
  assert.ok(
    stdout.includes('由 schema-to-markdown.mjs 生成,请勿手改'),
    'header must credit the generator and forbid hand edits',
  )
  assert.ok(stdout.includes('`1`'), 'header must state the apiVersion used')

  // 按命令名排序:乱序输入 → 有序输出。
  const jobAt = stdout.indexOf('## `exports.startVideo`')
  const updateAt = stdout.indexOf('## `objects.update`')
  const snapshotAt = stdout.indexOf('## `scene.getSnapshot`')
  assert.ok(jobAt !== -1 && updateAt !== -1 && snapshotAt !== -1)
  assert.ok(jobAt < updateAt && updateAt < snapshotAt, 'commands must be sorted by name')

  // project mutation:完整元数据块(brief 第 4 步的格式)。
  assert.ok(
    stdout.includes(
      '## `objects.update`\n\n' +
        '- Kind: `mutation`\n' +
        '- State: `project`\n' +
        '- Undoable: `single-step`\n' +
        '- Completion: `committed`\n' +
        '- Expected revision: yes',
    ),
  )
  assert.ok(stdout.includes('`INVALID_ARGUMENT`, `OBJECT_NOT_FOUND`, `REVISION_CONFLICT`'))

  // query:无 completion 行,errorCodes 为空时不渲染 Errors 段。
  const querySection = sectionOf(stdout, 'scene.getSnapshot')
  assert.ok(querySection.includes('- Kind: `query`'))
  assert.ok(querySection.includes('- Expected revision: no'))
  assert.ok(!querySection.includes('- Completion:'), 'queries omit completion')
  assert.ok(!querySection.includes('### Errors'), 'empty errorCodes omit the Errors section')

  // job:cancelable 标记 + Output 后同级 Job result。
  const jobSection = sectionOf(stdout, 'exports.startVideo')
  assert.ok(jobSection.includes('- Kind: `job`'))
  assert.ok(jobSection.includes('- Cancelable: yes'))
  assert.ok(jobSection.includes('### Job result'))
  assert.ok(jobSection.indexOf('### Job result') > jobSection.indexOf('### Output'))
  assert.ok(jobSection.includes('"fileId"'))

  // Input/Output JSON Schema 以 json 代码块输出。
  assert.ok(stdout.includes('```json\n{"type":"object"}\n```'))
  assert.ok(stdout.includes('"cameraId"'))
  assert.ok(stdout.includes('"revision"'))

  // validate/execute 函数与函数源码绝不进入 Markdown。
  for (const forbidden of ['validate', 'execute', '=>', 'function ']) {
    assert.ok(!stdout.includes(forbidden), `markdown must not contain: ${forbidden}`)
  }
})

test('same schema produces byte-identical markdown (deterministic)', async () => {
  const input = JSON.stringify(SCHEMA)
  const first = await runConverter(input)
  const second = await runConverter(input)
  assert.equal(first.code, 0)
  assert.equal(second.code, 0)
  assert.equal(first.stdout, second.stdout)
})

test('malformed schemas fail with INVALID_ARGUMENT and no partial output', async (t) => {
  const cases = {
    'stdin is not JSON': '{not-json',
    'missing commands': JSON.stringify({apiVersion: 1}),
    'commands is not an array': JSON.stringify({apiVersion: 1, commands: {}}),
    'command missing name': JSON.stringify({
      apiVersion: 1,
      commands: [{inputSchema: {}, outputSchema: {}}],
    }),
    'command missing inputSchema': JSON.stringify({
      apiVersion: 1,
      commands: [{name: 'a.b', outputSchema: {}}],
    }),
    'command missing outputSchema': JSON.stringify({
      apiVersion: 1,
      commands: [{name: 'a.b', inputSchema: {}}],
    }),
    'duplicate command names': JSON.stringify({
      apiVersion: 1,
      commands: [
        {name: 'a.b', kind: 'query', stateDomain: 'session', undoable: 'none', inputSchema: {}, outputSchema: {}, errorCodes: []},
        {name: 'a.b', kind: 'query', stateDomain: 'session', undoable: 'none', inputSchema: {}, outputSchema: {}, errorCodes: []},
      ],
    }),
  }
  for (const [label, input] of Object.entries(cases)) {
    await t.test(label, async () => {
      const {code, stdout, stderr} = await runConverter(input)
      assert.notEqual(code, 0, `${label}: must exit non-zero`)
      assert.equal(stdout, '', `${label}: no partial success output on stdout`)
      const error = JSON.parse(stderr)
      assert.equal(error.ok, false)
      assert.equal(error.error.code, 'INVALID_ARGUMENT')
    })
  }
})
