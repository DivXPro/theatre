import {
  HttpPatchAdapter,
  HttpSnapshotAdapter,
  loadSceneSyncState,
} from './sceneSync'

const url = '/api/scenes/Space'

function sceneServer(initial?: {content: unknown; revision: string}) {
  let saved = initial
  let revisionNumber = initial ? 1 : 0
  const commits = new Map<string, string>()
  let loseNextResponse = false
  const request = jest.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') {
        return saved
          ? new Response(JSON.stringify(saved.content), {
              headers: {ETag: saved.revision},
            })
          : new Response(null, {status: 404})
      }
      const headers = new Headers(init.headers)
      const commitId = headers.get('Idempotency-Key')!
      const previous = commits.get(commitId)
      if (previous) {
        return new Response(null, {status: 204, headers: {ETag: previous}})
      }
      const matches = saved
        ? headers.get('If-Match') === saved.revision
        : headers.get('If-None-Match') === '*'
      if (!matches) {
        return new Response(null, {
          status: 412,
          headers: saved ? {ETag: saved.revision} : {},
        })
      }
      const revision = `"${++revisionNumber}"`
      saved = {content: JSON.parse(init.body as string), revision}
      commits.set(commitId, revision)
      if (loseNextResponse) {
        loseNextResponse = false
        throw new Error('Response lost')
      }
      return new Response(null, {status: 204, headers: {ETag: revision}})
    },
  )
  return {
    request,
    saved: () => saved,
    commits,
    loseResponse: () => {
      loseNextResponse = true
    },
  }
}

test('loads the newest snapshot and prevents a stale session from overwriting it', async () => {
  const server = sceneServer({content: {camera: 0}, revision: '"1"'})
  const adapter = new HttpSnapshotAdapter(url, server.request)
  const first = await loadSceneSyncState(adapter)
  const second = await loadSceneSyncState(adapter)
  expect(first.initialState).toEqual({camera: 0})
  expect(server.request).toHaveBeenCalledWith(url, {cache: 'no-store'})

  await first.onStateChange({camera: 1})
  await expect(second.onStateChange({camera: 2})).rejects.toMatchObject({
    name: 'SceneRevisionConflictError',
    currentRevision: '"2"',
  })
  await expect(second.onStateChange({camera: 3})).rejects.toMatchObject({
    name: 'SceneRevisionConflictError',
  })
  expect(server.saved()).toEqual({content: {camera: 1}, revision: '"2"'})
  expect((await loadSceneSyncState(adapter)).initialState).toEqual({camera: 1})
})

test('creates a missing snapshot conditionally and retries a lost acknowledgement before committing newer edits', async () => {
  const server = sceneServer()
  const adapter = new HttpSnapshotAdapter(url, server.request)
  const state = await loadSceneSyncState(adapter, {throttleMs: 0})
  expect(state.initialState).toBeUndefined()
  expect(state.throttleMs).toBe(0)

  server.loseResponse()
  await expect(state.onStateChange({camera: 1})).rejects.toThrow(
    'Response lost',
  )
  await state.onStateChange({camera: 2})

  const [, [, first], [, retry], [, second]] = server.request.mock.calls
  expect(retry).toEqual(first)
  expect(new Headers(first?.headers).get('If-None-Match')).toBe('*')
  expect(new Headers(second?.headers).get('If-Match')).toBe('"1"')
  expect(server.commits.size).toBe(2)
  expect(server.saved()).toEqual({content: {camera: 2}, revision: '"2"'})
})

test('rejects a snapshot without a strong revision before enabling writes', async () => {
  const request = jest.fn(async () => {
    return new Response('{}', {headers: {ETag: 'W/"1"'}})
  })
  await expect(
    loadSceneSyncState(new HttpSnapshotAdapter(url, request)),
  ).rejects.toThrow('ETag')
  expect(request).toHaveBeenCalledTimes(1)
})

test('reports unsaved changes until the server confirms the latest edit', async () => {
  const server = sceneServer({content: {camera: 0}, revision: '"1"'})
  const adapter = new HttpSnapshotAdapter(url, server.request)
  const state = await loadSceneSyncState(adapter)
  expect(state.hasUnsavedChanges()).toBe(false)

  server.loseResponse()
  const pending = state.onStateChange({camera: 1})
  expect(state.hasUnsavedChanges()).toBe(true)
  await expect(pending).rejects.toThrow('Response lost')
  expect(state.hasUnsavedChanges()).toBe(true)

  await state.onStateChange({camera: 2})
  expect(state.hasUnsavedChanges()).toBe(false)
})

test('reports unsaved changes while a save is still in flight', async () => {
  const server = sceneServer({content: {camera: 0}, revision: '"1"'})
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') await gate
      return server.request(input, init)
    },
  )
  const state = await loadSceneSyncState(new HttpSnapshotAdapter(url, request))

  const pending = state.onStateChange({camera: 1})
  expect(state.hasUnsavedChanges()).toBe(true)
  release()
  await pending
  expect(state.hasUnsavedChanges()).toBe(false)
})

test('retries the same patch after a lost response and bases the next edit on its acknowledgement', async () => {
  const initial = {sheetsById: {'Scene/Main~1': {camera: {x: 0, y: 1}}}}
  let writes = 0
  const request = jest.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify(initial), {headers: {ETag: '"1"'}})
      }
      if (++writes === 1) throw new Error('Response lost')
      return new Response(null, {status: 204, headers: {ETag: `"${writes}"`}})
    },
  )
  const state = await loadSceneSyncState(new HttpPatchAdapter(url, request))
  const firstEdit = {sheetsById: {'Scene/Main~1': {camera: {x: 5, y: 1}}}}
  await expect(state.onStateChange(firstEdit)).rejects.toThrow('Response lost')
  expect(state.hasUnsavedChanges()).toBe(true)

  firstEdit.sheetsById['Scene/Main~1'].camera.x = 15
  await state.onStateChange(firstEdit)
  await state.onStateChange(JSON.parse(JSON.stringify(firstEdit)))

  expect(request).toHaveBeenCalledTimes(4)
  const [, [, first], [, retry], [, next]] = request.mock.calls
  expect(first?.method).toBe('PATCH')
  expect(new Headers(first?.headers).get('Content-Type')).toBe(
    'application/json-patch+json',
  )
  expect(new Headers(first?.headers).get('If-Match')).toBe('"1"')
  expect(retry).toEqual(first)
  expect(JSON.parse(first!.body as string)).toEqual([
    {op: 'replace', path: '/sheetsById/Scene~1Main~01/camera/x', value: 5},
  ])
  expect(new Headers(next?.headers).get('If-Match')).toBe('"2"')
  expect(JSON.parse(next!.body as string)).toEqual([
    {op: 'replace', path: '/sheetsById/Scene~1Main~01/camera/x', value: 15},
  ])
  expect(state.hasUnsavedChanges()).toBe(false)
})
