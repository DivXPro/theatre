import {strict as assert} from 'node:assert'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import WebSocket from 'ws'
import {createSceneStateServer} from './sceneStateServer'
import {
  HttpPatchAdapter,
  loadSceneSyncState,
} from '../../../packages/camera-studio/src/sceneSync'
import {
  sceneClientIdHeader,
  sceneRevisionPath,
  sceneStatePath,
} from '../src/sceneRevisionProtocol'

type TestCleanup = {after(cleanup: () => void | Promise<void>): void}

async function startSceneServer(context: TestCleanup, file: string) {
  const {middleware, attach} = createSceneStateServer(file)
  const server = createServer((req, res) =>
    middleware(req, res, () => res.writeHead(404).end()),
  )
  attach(server)
  context.after(() => {
    server.close()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}${sceneStatePath}`
}

async function sceneFile(context: TestCleanup) {
  const directory = await mkdtemp(join(tmpdir(), 'camera-host-scene-test-'))
  context.after(() => rm(directory, {recursive: true, force: true}))
  return join(directory, 'scene.json')
}

function scene(cameraName: string) {
  return {
    definitionVersion: '0.4.0',
    revisionHistory: [],
    sheetsById: {Scene: {cameraName}},
  }
}

function put(
  url: string,
  commitId: string,
  base: string | null,
  content: ReturnType<typeof scene>,
  clientId?: string,
) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': commitId,
      ...(base === null ? {'If-None-Match': '*'} : {'If-Match': base}),
      ...(clientId ? {[sceneClientIdHeader]: clientId} : {}),
    },
    body: JSON.stringify(content),
  })
}

test('accepts only one of two updates using the same ETag', async (context) => {
  const url = await startSceneServer(context, await sceneFile(context))
  assert.equal((await fetch(url)).status, 404)
  const seed = await put(url, 'seed', null, scene('Seed'))
  assert.equal(seed.status, 204)
  const base = seed.headers.get('etag')
  assert.match(base ?? '', /^".+"$/)
  assert.equal(
    (await put(url, 'late-create', null, scene('Other'))).status,
    412,
  )

  const names = ['Camera A', 'Camera B']
  const responses = await Promise.all(
    names.map((name, index) => put(url, `edit-${index}`, base, scene(name))),
  )
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [204, 412],
  )
  const winner = responses.findIndex((response) => response.status === 204)
  const revision = responses[winner]!.headers.get('etag')
  assert.notEqual(revision, base)
  assert.equal(responses[1 - winner]!.headers.get('etag'), revision)
  const stored = await fetch(url)
  assert.equal(stored.headers.get('etag'), revision)
  assert.deepEqual(await stored.json(), scene(names[winner]!))
})

test('replays the original result after reopening the store and rejects reuse with a different request', async (context) => {
  const file = await sceneFile(context)
  const initialUrl = await startSceneServer(context, file)
  const original = await put(initialUrl, 'original', null, scene('First'))
  assert.equal(original.status, 204)
  const originalRevision = original.headers.get('etag')
  assert.ok(originalRevision)
  const latest = await put(
    initialUrl,
    'latest',
    originalRevision,
    scene('Latest'),
  )
  assert.equal(latest.status, 204)

  const reopenedUrl = await startSceneServer(context, file)
  const replay = await put(reopenedUrl, 'original', null, scene('First'))
  assert.equal(replay.status, 204)
  assert.equal(replay.headers.get('etag'), originalRevision)
  assert.equal(
    (await put(reopenedUrl, 'original', null, scene('Different'))).status,
    409,
  )
  assert.equal(
    (await put(reopenedUrl, 'original', originalRevision, scene('First')))
      .status,
    409,
  )
  const stored = await fetch(reopenedUrl)
  assert.equal(stored.headers.get('etag'), latest.headers.get('etag'))
  assert.deepEqual(await stored.json(), scene('Latest'))
})

test('requires a version precondition before saving', async (context) => {
  const url = await startSceneServer(context, await sceneFile(context))
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'unconditional',
    },
    body: JSON.stringify(scene('Missing version')),
  })
  assert.equal(response.status, 428)
  assert.equal((await fetch(url)).status, 404)
})

test(
  'saves incremental edits, broadcasts the persisted version and preserves conflicting edits in the other session',
  {timeout: 5000},
  async (context) => {
    const file = await sceneFile(context)
    const url = await startSceneServer(context, file)
    const first = await loadSceneSyncState(new HttpPatchAdapter(url))
    assert.equal(first.initialState, undefined)
    await first.onStateChange(scene('Seed'))
    const second = await loadSceneSyncState(new HttpPatchAdapter(url))
    assert.deepEqual(second.initialState, scene('Seed'))

    const socket = openRevisionFeed(context, url)
    const initialNotice = await nextRevision(socket)
    const changed = nextRevision(socket)
    await first.onStateChange(scene('Remote camera'))
    const {revision} = await changed
    assert.notEqual(revision, initialNotice.revision)

    await assert.rejects(second.onStateChange(scene('Local camera')), {
      name: 'SceneRevisionConflictError',
      currentRevision: revision,
    })
    assert.equal(second.hasUnsavedChanges(), true)

    const reopened = await startSceneServer(context, file)
    const latest = await loadSceneSyncState(new HttpPatchAdapter(reopened))
    assert.deepEqual(latest.initialState, scene('Remote camera'))
  },
)

test('enforces patch preconditions, applies changes atomically and replays successful patch requests', async (context) => {
  const url = await startSceneServer(context, await sceneFile(context))
  const seed = await put(url, 'seed', null, scene('Seed'))
  const base = seed.headers.get('etag')!
  const edit = {
    op: 'replace',
    path: '/sheetsById/Scene/cameraName',
    value: 'Edited',
  }
  const patch = (commitId: string, operations: unknown[]) =>
    fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json-patch+json',
        'Idempotency-Key': commitId,
        'If-Match': base,
      },
      body: JSON.stringify(operations),
    })

  const invalid = await patch('invalid', [
    edit,
    {op: 'remove', path: '/missing'},
  ])
  assert.equal(invalid.status, 400)
  const unchanged = await fetch(url)
  assert.equal(unchanged.headers.get('etag'), base)
  assert.deepEqual(await unchanged.json(), scene('Seed'))

  const saved = await patch('edit', [edit])
  assert.equal(saved.status, 204)
  const retried = await patch('edit', [edit])
  assert.equal(retried.status, 204)
  assert.equal(retried.headers.get('etag'), saved.headers.get('etag'))
  assert.equal(
    (await patch('edit', [{...edit, value: 'Different'}])).status,
    409,
  )
  assert.equal((await patch('stale', [edit])).status, 412)
  assert.deepEqual(await (await fetch(url)).json(), scene('Edited'))
})

function openRevisionFeed(context: TestCleanup, sceneUrl: string) {
  const url = new URL(sceneRevisionPath, sceneUrl)
  url.protocol = 'ws:'
  const socket = new WebSocket(url)
  context.after(() => socket.terminate())
  return socket
}

async function nextRevision(socket: WebSocket) {
  const [message] = await once(socket, 'message')
  return JSON.parse(String(message))
}

test(
  'publishes only new persisted revisions and sends the latest revision on reconnect',
  {timeout: 5000},
  async (context) => {
    const url = await startSceneServer(context, await sceneFile(context))
    const socket = openRevisionFeed(context, url)
    await once(socket, 'open')

    const firstNotice = nextRevision(socket)
    const seeded = await put(
      url,
      'seed',
      null,
      scene('Initial camera'),
      'first-tab',
    )
    const firstTag = seeded.headers.get('etag')
    assert.ok(firstTag)
    assert.deepEqual(await firstNotice, {
      revision: firstTag,
      clientId: 'first-tab',
    })
    const stored = await fetch(url)
    assert.equal(stored.headers.get('etag'), firstTag)
    assert.deepEqual(await stored.json(), scene('Initial camera'))

    const nextNotice = nextRevision(socket)
    assert.equal(
      (await put(url, 'seed', null, scene('Initial camera'), 'first-tab'))
        .status,
      204,
    )
    assert.equal(
      (await put(url, 'stale', null, scene('Stale camera'))).status,
      412,
    )
    const updated = await put(
      url,
      'update',
      firstTag,
      scene('New camera'),
      'second-tab',
    )
    const latestTag = updated.headers.get('etag')
    assert.ok(latestTag)
    assert.deepEqual(await nextNotice, {
      revision: latestTag,
      clientId: 'second-tab',
    })

    socket.close()
    const reconnected = openRevisionFeed(context, url)
    assert.deepEqual(await nextRevision(reconnected), {
      revision: latestTag,
      clientId: 'second-tab',
    })
  },
)
