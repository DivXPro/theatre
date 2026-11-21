import {createHash, randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import type {IncomingMessage, Server, ServerResponse} from 'node:http'
import {dirname} from 'node:path'
import type {Connect} from 'vite'
import WebSocket, {WebSocketServer} from 'ws'
import {
  sceneClientIdHeader,
  sceneRevisionPath,
  sceneStatePath,
  type SceneRevisionNotice,
} from '../src/sceneRevisionProtocol'

const maxSnapshotBytes = 8 * 1024 * 1024
const strongETag = /^"[\x21\x23-\x7e\x80-\xff]*"$/
const identifier = /^[\w-]{1,128}$/

type StoredScene = SceneRevisionNotice & {
  body: string
  commits: Record<string, {fingerprint: string; revision: string}>
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size <= maxSnapshotBytes) chunks.push(chunk)
  }
  if (size > maxSnapshotBytes) return null
  const buffer = Buffer.concat(chunks)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSnapshot(value: unknown) {
  return (
    isObject(value) &&
    typeof value.definitionVersion === 'string' &&
    Array.isArray(value.revisionHistory) &&
    isObject(value.sheetsById)
  )
}

function arrayIndex(key: string): number {
  return /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : Infinity
}

function applyPatch(document: unknown, operations: unknown): unknown {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Expected a non-empty JSON Patch')
  }
  for (const operation of operations) {
    if (!isObject(operation)) throw new Error('Invalid operation')
    const {op, path, value} = operation
    if (
      (op !== 'add' && op !== 'remove' && op !== 'replace') ||
      typeof path !== 'string' ||
      (op !== 'remove' && !Object.hasOwn(operation, 'value')) ||
      /~(?![01])/.test(path)
    ) {
      throw new Error('Invalid operation')
    }
    if (path === '' && op !== 'remove') {
      document = value
      continue
    }
    if (!path.startsWith('/')) throw new Error('Invalid JSON Pointer')
    const segments = path
      .slice(1)
      .split('/')
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    const key = segments.pop()!
    let parent = document
    for (const segment of segments) {
      if (Array.isArray(parent) && arrayIndex(segment) < parent.length) {
        parent = parent[arrayIndex(segment)]
      } else if (isObject(parent) && Object.hasOwn(parent, segment)) {
        parent = parent[segment]
      } else {
        throw new Error('JSON Pointer parent is missing')
      }
    }
    if (Array.isArray(parent)) {
      const index =
        op === 'add' && key === '-' ? parent.length : arrayIndex(key)
      if (index > parent.length || (op !== 'add' && index === parent.length)) {
        throw new Error('Invalid array index')
      }
      if (op === 'add') parent.splice(index, 0, value)
      else if (op === 'remove') parent.splice(index, 1)
      else parent[index] = value
    } else if (
      isObject(parent) &&
      (op === 'add' || Object.hasOwn(parent, key))
    ) {
      if (op === 'remove') delete parent[key]
      else
        Object.defineProperty(parent, key, {
          value,
          configurable: true,
          enumerable: true,
          writable: true,
        })
    } else {
      throw new Error('JSON Pointer target is missing')
    }
  }
  return document
}

export function createSceneStateServer(filename: string) {
  const revisions = new WebSocketServer({noServer: true, maxPayload: 1024})
  let queue = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>) => {
    const result = queue.then(operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const load = async (): Promise<StoredScene | null> => {
    try {
      return JSON.parse(await readFile(filename, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  const save = async (state: StoredScene) => {
    await mkdir(dirname(filename), {recursive: true})
    const temporaryFile = `${filename}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryFile, JSON.stringify(state), {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporaryFile, filename)
    } catch (error) {
      await rm(temporaryFile, {force: true}).catch(() => {})
      throw error
    }
  }

  const send = (socket: WebSocket, message: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message, (error) => {
        if (error) socket.terminate()
      })
    }
  }

  const attach = (server: Server) => {
    server.on('upgrade', (request, socket, head) => {
      if (request.url?.split('?')[0] !== sceneRevisionPath) return
      const {origin, host} = request.headers
      if (
        origin &&
        origin !== `http://${host}` &&
        origin !== `https://${host}`
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      revisions.handleUpgrade(request, socket, head, (subscriber) => {
        subscriber.on('error', () => subscriber.terminate())
        void enqueue(async () => {
          const stored = await load()
          if (stored) {
            const {revision, clientId} = stored
            send(subscriber, JSON.stringify({revision, clientId}))
          }
        }).catch(() => subscriber.close(1011))
      })
    })
    server.once('close', () => {
      for (const socket of revisions.clients) socket.terminate()
      revisions.close()
    })
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'GET') {
      const stored = await load()
      if (stored === null) return response.writeHead(404).end()
      return response
        .writeHead(200, {
          'Content-Type': 'application/json',
          ETag: stored.revision,
        })
        .end(stored.body)
    }
    const patch = request.method === 'PATCH'
    if (request.method !== 'PUT' && !patch) {
      return response.writeHead(405, {Allow: 'GET, PUT, PATCH'}).end()
    }

    const ifMatch = request.headers['if-match']
    const ifNoneMatch = request.headers['if-none-match']
    if (ifMatch === undefined && ifNoneMatch === undefined) {
      return response.writeHead(428).end()
    }
    const creating = !patch && ifNoneMatch === '*' && ifMatch === undefined
    const updating =
      ifNoneMatch === undefined &&
      typeof ifMatch === 'string' &&
      strongETag.test(ifMatch)
    const commitId = request.headers['idempotency-key']
    const source = request.headers[sceneClientIdHeader]
    const clientId =
      typeof source === 'string' && identifier.test(source) ? source : undefined
    if (
      (!creating && !updating) ||
      typeof commitId !== 'string' ||
      !identifier.test(commitId) ||
      (source !== undefined && clientId === undefined)
    ) {
      return response.writeHead(400).end()
    }
    const contentType = request.headers['content-type']?.split(';')[0]
    const expectedType = patch
      ? 'application/json-patch+json'
      : 'application/json'
    if (contentType?.trim().toLowerCase() !== expectedType) {
      return response.writeHead(415).end()
    }
    const bytes = await readRequestBody(request)
    if (bytes === null) return response.writeHead(413).end()
    let body: string
    let value: unknown
    try {
      body = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
        bytes,
      )
      value = JSON.parse(body)
    } catch {
      return response.writeHead(400).end()
    }
    if (!patch && !isSnapshot(value)) return response.writeHead(400).end()

    const base = ifMatch ?? null
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(patch ? ['PATCH', base, body] : [base, body]))
      .digest('hex')
    const {status, revision} = await enqueue(async () => {
      const stored = await load()
      if (stored && Object.hasOwn(stored.commits, commitId)) {
        const previous = stored.commits[commitId]!
        return previous.fingerprint === fingerprint
          ? {status: 204, revision: previous.revision}
          : {status: 409}
      }
      const current = stored?.revision ?? null
      if (base !== current) return {status: 412, revision: current}

      let snapshotBody = body
      if (patch) {
        if (!stored) return {status: 412}
        try {
          const updated = applyPatch(JSON.parse(stored.body), value)
          if (!isSnapshot(updated)) return {status: 400}
          snapshotBody = JSON.stringify(updated)
        } catch {
          return {status: 400}
        }
        if (Buffer.byteLength(snapshotBody) > maxSnapshotBytes)
          return {status: 413}
      }
      const revision = `"${randomUUID()}"`
      await save({
        body: snapshotBody,
        revision,
        clientId,
        commits: {...stored?.commits, [commitId]: {fingerprint, revision}},
      })
      const message = JSON.stringify({revision, clientId})
      for (const socket of revisions.clients) send(socket, message)
      return {status: 204, revision}
    })
    if (revision) response.setHeader('ETag', revision)
    return response.writeHead(status).end()
  }

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== sceneStatePath) return next()
    void handle(request, response).catch((error) => {
      console.error('[camera-host-demo] Scene state request failed', error)
      response.writeHead(500).end()
    })
  }

  return {middleware, attach}
}
