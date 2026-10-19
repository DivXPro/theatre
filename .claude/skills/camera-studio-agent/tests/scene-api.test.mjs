import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {basename, join} from 'node:path'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import {tmpdir} from 'node:os'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(
  new URL('../scripts/scene-api.mjs', import.meta.url),
)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const SCHEMA = {
  apiVersion: '2026-10-17',
  commands: [
    {name: 'models.create', kind: 'mutation'},
    {name: 'cameras.create', kind: 'mutation'},
    {name: 'scene.getSnapshot', kind: 'query'},
  ],
  capabilities: [],
  errors: ['UNAUTHORIZED', 'OBJECT_NOT_FOUND'],
}

/**
 * 假桥接服务器:覆盖 health/schema/commands/files/jobs 路由,
 * 通过 state 暴露接收到的 requestId、上传字节和可编排的任务序列。
 */
function createFakeBridge() {
  const state = {
    hits: 0,
    receivedRequestIds: [],
    failCommandsWith401: false,
    breakDownload: false,
    uploads: new Map(),
    nextFileId: 1,
    jobQueues: new Map(),
  }

  const server = createServer((req, res) => {
    state.hits += 1
    const url = new URL(req.url, 'http://127.0.0.1')
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const sendJson = (status, payload) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(payload))
      }
      try {
        if (url.pathname === '/v1/health') {
          return sendJson(200, {
            ok: true,
            result: {bridge: 'running', scene: {state: 'connected'}},
          })
        }
        if (url.pathname === '/v1/schema') {
          return sendJson(200, {ok: true, result: SCHEMA})
        }
        if (url.pathname === '/v1/commands' && req.method === 'POST') {
          const body = JSON.parse(raw.toString('utf8'))
          state.receivedRequestIds.push(body.requestId)
          if (state.failCommandsWith401) {
            return sendJson(401, {
              ok: false,
              error: {
                code: 'UNAUTHORIZED',
                message: 'bad credentials',
                retryable: false,
              },
            })
          }
          if (body.name === 'models.create') {
            return sendJson(200, {
              ok: true,
              result: {objectId: 'model:one', revision: 7},
            })
          }
          if (body.name === 'scene.getSnapshot') {
            return sendJson(200, {ok: true, result: {objects: []}})
          }
          return sendJson(404, {
            ok: false,
            error: {
              code: 'COMMAND_NOT_FOUND',
              message: `unknown command: ${body.name}`,
              retryable: false,
            },
          })
        }
        if (url.pathname === '/v1/files' && req.method === 'POST') {
          const fileName = decodeURIComponent(req.headers['x-file-name'] ?? '')
          const mimeType =
            req.headers['content-type'] ?? 'application/octet-stream'
          const fileId = `file-${state.nextFileId++}`
          state.uploads.set(fileId, {
            buffer: Buffer.from(raw),
            fileName,
            mimeType,
          })
          return sendJson(201, {
            ok: true,
            result: {fileId, fileName, mimeType, size: raw.length},
          })
        }
        if (url.pathname.startsWith('/v1/files/') && req.method === 'GET') {
          const fileId = url.pathname.slice('/v1/files/'.length)
          const entry = state.uploads.get(fileId)
          if (!entry) {
            return sendJson(404, {
              ok: false,
              error: {
                code: 'FILE_NOT_FOUND',
                message: `no such file: ${fileId}`,
                retryable: false,
              },
            })
          }
          res.statusCode = 200
          res.setHeader('Content-Type', entry.mimeType)
          res.setHeader('Content-Length', String(entry.buffer.length))
          if (state.breakDownload) {
            res.write(entry.buffer.subarray(0, 1))
            return res.destroy()
          }
          return res.end(entry.buffer)
        }
        if (url.pathname.startsWith('/v1/jobs/')) {
          const rest = url.pathname.slice('/v1/jobs/'.length)
          if (req.method === 'GET') {
            const queue = state.jobQueues.get(rest)
            if (!queue) {
              return sendJson(404, {
                ok: false,
                error: {
                  code: 'JOB_NOT_FOUND',
                  message: `no such job: ${rest}`,
                  retryable: false,
                },
              })
            }
            const snapshot = queue.length > 1 ? queue.shift() : queue[0]
            return sendJson(200, {ok: true, result: snapshot})
          }
          if (req.method === 'POST' && rest.endsWith('/cancel')) {
            const jobId = rest.slice(0, -'/cancel'.length)
            return sendJson(202, {
              ok: true,
              result: {
                jobId,
                kind: 'models.import',
                state: 'cancelled',
                progress: 0,
                phase: 'accepted',
                cancelable: false,
              },
            })
          }
        }
        sendJson(404, {
          ok: false,
          error: {
            code: 'OBJECT_NOT_FOUND',
            message: `no route: ${url.pathname}`,
            retryable: false,
          },
        })
      } catch (err) {
        sendJson(500, {
          ok: false,
          error: {code: 'NETWORK_ERROR', message: String(err), retryable: true},
        })
      }
    })
  })

  return {server, state}
}

async function withBridge(t, fn) {
  const {server, state} = createFakeBridge()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  t.after(() => server.close())
  return fn({baseUrl, state})
}

function makeRunCli(baseUrl) {
  return async function runCli(args, {env = {}} = {}) {
    try {
      const {stdout, stderr} = await execFileAsync(
        process.execPath,
        [script, ...args],
        {
          env: {
            ...process.env,
            CAMERA_STUDIO_API_URL: baseUrl,
            CAMERA_STUDIO_TOKEN: 'test-secret',
            ...env,
          },
        },
      )
      return {
        code: 0,
        stdout,
        stderr,
        get json() {
          return JSON.parse(stdout)
        },
      }
    } catch (err) {
      return {code: err.code ?? 1, stdout: err.stdout, stderr: err.stderr}
    }
  }
}

test('call emits json and reuses an explicit request id', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const runCli = makeRunCli(baseUrl)
    const first = await runCli([
      'call',
      'models.create',
      '{"assetId":"m1"}',
      '--request-id',
      'retry-1',
    ])
    const second = await runCli([
      'call',
      'models.create',
      '{"assetId":"m1"}',
      '--request-id',
      'retry-1',
    ])
    assert.equal(first.code, 0)
    assert.equal(first.json.objectId, 'model:one')
    assert.equal(second.json.objectId, 'model:one')
    assert.equal(
      state.receivedRequestIds.filter((id) => id === 'retry-1').length,
      2,
    )
  })
})

test('health returns the bridge status envelope result', async (t) => {
  await withBridge(t, async ({baseUrl}) => {
    const {code, json} = await makeRunCli(baseUrl)(['health'])
    assert.equal(code, 0)
    assert.equal(json.bridge, 'running')
    assert.equal(json.scene.state, 'connected')
  })
})

test('missing token fails before any request is sent', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const result = await makeRunCli(baseUrl)(['health'], {
      env: {CAMERA_STUDIO_TOKEN: ''},
    })
    assert.equal(result.code, 2)
    assert.equal(state.hits, 0)
    const err = JSON.parse(result.stderr)
    assert.equal(err.ok, false)
    assert.equal(err.error.code, 'UNAUTHORIZED')
  })
})

test('401 surfaces only UNAUTHORIZED and never leaks the token', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    state.failCommandsWith401 = true
    const result = await makeRunCli(baseUrl)([
      'call',
      'models.create',
      '{"assetId":"m1"}',
    ])
    assert.equal(result.code, 1)
    const err = JSON.parse(result.stderr)
    assert.equal(err.error.code, 'UNAUTHORIZED')
    assert.ok(!result.stdout.includes('test-secret'))
    assert.ok(!result.stderr.includes('test-secret'))
  })
})

test('call auto-generates a fresh UUID request id per invocation', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const runCli = makeRunCli(baseUrl)
    await runCli(['call', 'models.create', '{"assetId":"m1"}'])
    await runCli(['call', 'models.create', '{"assetId":"m1"}'])
    const [first, second] = state.receivedRequestIds
    assert.ok(UUID_RE.test(first), `not a uuid: ${first}`)
    assert.ok(UUID_RE.test(second), `not a uuid: ${second}`)
    assert.notEqual(first, second)
  })
})

test('schema filters to a single named command', async (t) => {
  await withBridge(t, async ({baseUrl}) => {
    const all = await makeRunCli(baseUrl)(['schema'])
    assert.equal(all.code, 0)
    assert.equal(all.json.commands.length, 3)
    const single = await makeRunCli(baseUrl)(['schema', 'cameras.create'])
    assert.equal(single.code, 0)
    assert.equal(single.json.commands.length, 1)
    assert.equal(single.json.commands[0].name, 'cameras.create')
  })
})

test('invalid JSON args exit 2 before sending a request', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const hitsBefore = state.hits
    const result = await makeRunCli(baseUrl)([
      'call',
      'models.create',
      '{not-json',
    ])
    assert.equal(result.code, 2)
    assert.equal(state.hits, hitsBefore)
    const err = JSON.parse(result.stderr)
    assert.equal(err.error.code, 'INVALID_ARGUMENT')
  })
})

test('wait polls running then succeeds with the terminal snapshot', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    state.jobQueues.set('job-1', [
      {
        jobId: 'job-1',
        kind: 'models.import',
        state: 'running',
        progress: 0.3,
        phase: 'accepted',
        cancelable: true,
      },
      {
        jobId: 'job-1',
        kind: 'models.import',
        state: 'succeeded',
        progress: 1,
        phase: 'mounted',
        cancelable: false,
        result: {assetId: 'a1'},
      },
    ])
    const {code, json} = await makeRunCli(baseUrl)([
      'wait',
      'job-1',
      '--interval-ms',
      '10',
      '--timeout-ms',
      '5000',
    ])
    assert.equal(code, 0)
    assert.equal(json.state, 'succeeded')
    assert.equal(json.result.assetId, 'a1')
  })
})

test('wait exits 1 on a failed job and reports the job error', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    state.jobQueues.set('job-2', [
      {
        jobId: 'job-2',
        kind: 'exports.video',
        state: 'failed',
        progress: 0.5,
        phase: 'accepted',
        cancelable: false,
        error: {code: 'EXPORT_FAILED', message: 'boom', retryable: false},
      },
    ])
    const result = await makeRunCli(baseUrl)([
      'wait',
      'job-2',
      '--interval-ms',
      '10',
      '--timeout-ms',
      '5000',
    ])
    assert.equal(result.code, 1)
    const err = JSON.parse(result.stderr)
    assert.equal(err.error.code, 'EXPORT_FAILED')
  })
})

test('job queries a snapshot and cancel posts a cancel', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    state.jobQueues.set('job-3', [
      {
        jobId: 'job-3',
        kind: 'models.import',
        state: 'pending',
        progress: 0,
        phase: 'accepted',
        cancelable: true,
      },
    ])
    const runCli = makeRunCli(baseUrl)
    const job = await runCli(['job', 'job-3'])
    assert.equal(job.code, 0)
    assert.equal(job.json.state, 'pending')
    const cancel = await runCli(['cancel', 'job-3'])
    assert.equal(cancel.code, 0)
    assert.equal(cancel.json.state, 'cancelled')
  })
})

test('upload sends exact bytes and an encoded unicode file name', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const dir = mkdtempSync(join(tmpdir(), 'scene-api-upload-'))
    const bytes = Buffer.from([0x00, 0x9f, 0xff, 0x01, 0x80, 0xfe, 0x42])
    const fileName = '模型-ü.fbx'
    const filePath = join(dir, fileName)
    writeFileSync(filePath, bytes)
    const {code, json} = await makeRunCli(baseUrl)(['upload', filePath])
    assert.equal(code, 0)
    assert.equal(json.size, bytes.length)
    const entry = state.uploads.get(json.fileId)
    assert.ok(entry, 'server should have stored the upload')
    assert.ok(entry.buffer.equals(bytes), 'uploaded bytes must match exactly')
    assert.equal(entry.fileName, fileName)
  })
})

test('download refuses overwrite by default and --force overwrites', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const dir = mkdtempSync(join(tmpdir(), 'scene-api-download-'))
    const bytes = Buffer.from('export-bytes')
    state.uploads.set('file-dl', {
      buffer: bytes,
      fileName: 'out.bin',
      mimeType: 'application/octet-stream',
    })
    const output = join(dir, 'out.bin')
    const runCli = makeRunCli(baseUrl)

    const first = await runCli(['download', 'file-dl', output])
    assert.equal(first.code, 0)
    assert.ok(readFileSync(output).equals(bytes))

    writeFileSync(output, 'tampered')
    const second = await runCli(['download', 'file-dl', output])
    assert.equal(second.code, 1)
    const err = JSON.parse(second.stderr)
    assert.equal(err.error.code, 'FILE_EXISTS')
    assert.equal(readFileSync(output, 'utf8'), 'tampered')

    const forced = await runCli(['download', 'file-dl', output, '--force'])
    assert.equal(forced.code, 0)
    assert.ok(readFileSync(output).equals(bytes))
  })
})

test('download failure leaves no partial or temp files behind', async (t) => {
  await withBridge(t, async ({baseUrl, state}) => {
    const dir = mkdtempSync(join(tmpdir(), 'scene-api-dlfail-'))
    const output = join(dir, 'out.bin')
    const runCli = makeRunCli(baseUrl)

    // HTTP 层错误:文件不存在。
    const notFound = await runCli(['download', 'file-missing', output])
    assert.equal(notFound.code, 1)
    assert.equal(existsSync(output), false)

    // 流中途断连。
    const bytes = Buffer.from('partial-payload')
    state.uploads.set('file-break', {
      buffer: bytes,
      fileName: 'out.bin',
      mimeType: 'application/octet-stream',
    })
    state.breakDownload = true
    const broken = await runCli(['download', 'file-break', output])
    assert.equal(broken.code, 1)
    assert.equal(existsSync(output), false)
    const leftovers = readdirSync(dir).filter((name) => name !== 'out.bin')
    assert.deepEqual(leftovers, [], `temp files left: ${leftovers}`)
  })
})

test('--help lists every command and env vars without needing a token', async (t) => {
  await withBridge(t, async ({baseUrl}) => {
    const result = await makeRunCli(baseUrl)(['--help'], {
      env: {CAMERA_STUDIO_TOKEN: ''},
    })
    assert.equal(result.code, 0)
    for (const needle of [
      'health',
      'schema',
      'call',
      'upload',
      'job',
      'wait',
      'cancel',
      'download',
      'CAMERA_STUDIO_API_URL',
      'CAMERA_STUDIO_TOKEN',
    ]) {
      assert.ok(
        result.stdout.includes(needle),
        `--help should mention ${needle}`,
      )
    }
    assert.ok(!result.stdout.includes('test-secret'))
  })
})
