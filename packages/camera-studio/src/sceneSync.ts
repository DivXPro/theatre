export interface SceneSyncSnapshot {
  content: unknown
  revision: string
}

export interface SceneCommit {
  content: unknown
  baseRevision: string | null
  commitId: string
}

export type ScenePatchOperation =
  | {op: 'add' | 'replace'; path: string; value: unknown}
  | {op: 'remove'; path: string}

export interface ScenePatchCommit {
  operations: ScenePatchOperation[]
  baseRevision: string
  commitId: string
}

export interface SceneSyncAdapter {
  load(): Promise<SceneSyncSnapshot | null>
  commit(change: SceneCommit): Promise<{revision: string}>
  commitPatch?(change: ScenePatchCommit): Promise<{revision: string}>
  subscribe?(onRevision: (revision: string) => void): () => void
}

export interface SceneSyncState {
  initialState: unknown
  throttleMs?: number
  onStateChange(content: unknown): Promise<void>
  /**
   * 本会话是否有本地编辑尚未被服务端确认：排队中、请求在途、
   * 响应丢失待重试，或被拒绝后仍留在页面上的改动都算。
   */
  hasUnsavedChanges(): boolean
}

export class SceneCommitRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SceneCommitRejectedError'
  }
}

export class SceneRevisionConflictError extends SceneCommitRejectedError {
  constructor(readonly currentRevision?: string) {
    super('场景已在别处更新，当前保存与服务端版本冲突')
    this.name = 'SceneRevisionConflictError'
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createScenePatch(
  previous: unknown,
  next: unknown,
): ScenePatchOperation[] {
  const operations: ScenePatchOperation[] = []
  const compare = (before: unknown, after: unknown, path: string) => {
    if (before === after) return
    if (isJsonObject(before) && isJsonObject(after)) {
      const childPath = (key: string) =>
        `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
      for (const key of Object.keys(before)) {
        if (!Object.prototype.hasOwnProperty.call(after, key)) {
          operations.push({op: 'remove', path: childPath(key)})
        }
      }
      for (const [key, value] of Object.entries(after)) {
        if (Object.prototype.hasOwnProperty.call(before, key)) {
          compare(before[key], value, childPath(key))
        } else {
          operations.push({op: 'add', path: childPath(key), value})
        }
      }
    } else if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length
    ) {
      after.forEach((value, index) =>
        compare(before[index], value, `${path}/${index}`),
      )
    } else {
      operations.push({op: 'replace', path, value: after})
    }
  }
  compare(previous, next, '')
  return operations
}

export async function loadSceneSyncState(
  adapter: SceneSyncAdapter,
  options: {throttleMs?: number} = {},
): Promise<SceneSyncState> {
  const snapshot = await adapter.load()
  const commitPatch = adapter.commitPatch?.bind(adapter)
  let revision = snapshot?.revision ?? null
  let baseline =
    commitPatch && snapshot
      ? (JSON.parse(JSON.stringify(snapshot.content)) as unknown)
      : undefined
  type PendingCommit = {
    content: unknown
    write: () => Promise<{revision: string}>
  }
  let unconfirmed: PendingCommit | undefined
  let queue = Promise.resolve()
  let requestedChanges = 0
  let confirmedChanges = 0

  const send = async (change: PendingCommit) => {
    unconfirmed = change
    try {
      const result = await change.write()
      revision = result.revision
      if (commitPatch) baseline = change.content
      unconfirmed = undefined
    } catch (error) {
      if (error instanceof SceneCommitRejectedError) unconfirmed = undefined
      throw error
    }
  }

  return {
    initialState: snapshot?.content,
    throttleMs: options.throttleMs,
    onStateChange: async (content: unknown) => {
      const sequence = ++requestedChanges
      const document: unknown = commitPatch
        ? JSON.parse(JSON.stringify(content))
        : content
      const save = queue.then(async () => {
        if (unconfirmed) {
          const retry = unconfirmed
          await send(retry)
          if (!commitPatch && Object.is(retry.content, content)) {
            confirmedChanges = sequence
            return
          }
        }
        const commitId = Array.from(
          globalThis.crypto.getRandomValues(new Uint32Array(4)),
          (part) => part.toString(16).padStart(8, '0'),
        ).join('')
        const baseRevision = revision
        if (commitPatch && baseRevision !== null) {
          const operations = createScenePatch(baseline, document)
          if (operations.length > 0) {
            await send({
              content: document,
              write: () => commitPatch({operations, baseRevision, commitId}),
            })
          }
        } else {
          await send({
            content: document,
            write: () =>
              adapter.commit({content: document, baseRevision, commitId}),
          })
        }
        confirmedChanges = sequence
      })
      queue = save.catch(() => {})
      return save
    },
    hasUnsavedChanges: () => confirmedChanges < requestedChanges,
  }
}

function requireStrongETag(value: string | null): string {
  if (!value || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)) {
    throw new Error('场景接口需要提供强 ETag 作为保存版本')
  }
  return value
}

export class HttpSnapshotAdapter implements SceneSyncAdapter {
  constructor(
    private readonly url: string | URL,
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async load(): Promise<SceneSyncSnapshot | null> {
    const result = await this.request(this.url, {cache: 'no-store'})
    if (result.status === 404) return null
    if (!result.ok) throw new Error(`读取场景失败（HTTP ${result.status}）`)
    const revision = requireStrongETag(result.headers.get('ETag'))
    return {content: await result.json(), revision}
  }

  async commit(change: SceneCommit): Promise<{revision: string}> {
    return this.write('PUT', change, change.content)
  }

  protected async write(
    method: 'PUT' | 'PATCH',
    change: Pick<SceneCommit, 'baseRevision' | 'commitId'>,
    body: unknown,
  ): Promise<{revision: string}> {
    const headers = new Headers({
      'Content-Type':
        method === 'PATCH' ? 'application/json-patch+json' : 'application/json',
      'Idempotency-Key': change.commitId,
    })
    if (change.baseRevision === null) {
      headers.set('If-None-Match', '*')
    } else {
      headers.set('If-Match', requireStrongETag(change.baseRevision))
    }
    const result = await this.request(this.url, {
      method,
      headers,
      body: JSON.stringify(body),
    })
    if (result.status === 412) {
      throw new SceneRevisionConflictError(
        result.headers.get('ETag') ?? undefined,
      )
    }
    if (!result.ok) {
      const message = `写入场景失败（HTTP ${result.status}）`
      if (
        result.status >= 400 &&
        result.status < 500 &&
        result.status !== 408 &&
        result.status !== 429
      ) {
        throw new SceneCommitRejectedError(message)
      }
      throw new Error(message)
    }
    return {revision: requireStrongETag(result.headers.get('ETag'))}
  }
}

export class HttpPatchAdapter extends HttpSnapshotAdapter {
  async commitPatch(change: ScenePatchCommit): Promise<{revision: string}> {
    return this.write('PATCH', change, change.operations)
  }
}
