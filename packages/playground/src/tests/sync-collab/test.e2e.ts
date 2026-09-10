import {test, expect} from '@playwright/test'
import {spawn} from 'child_process'
import * as path from 'path'
import * as http from 'http'
import * as net from 'net'

const MONOREPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..')

const findOpenPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })

const waitForServer = (port: number, timeoutMs = 20000): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      const req = http.get(
        {host: 'localhost', port, path: '/', timeout: 500},
        (res) => {
          res.resume()
          if (res.statusCode === 200) return resolve()
          if (Date.now() - start > timeoutMs)
            return reject(new Error('sync-server not ready'))
          setTimeout(poll, 300)
        },
      )
      req.on('error', () => {
        if (Date.now() - start > timeoutMs)
          return reject(new Error('sync-server not ready'))
        setTimeout(poll, 300)
      })
    }
    poll()
  })

// Waits until nothing accepts connections on `port` — the killed server's
// listening socket is gone (ECONNREFUSED). Restarting on the same port before
// this resolves risks EADDRINUSE from the dying process still holding the socket.
const waitForPortDown = (port: number, timeoutMs = 20000): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now()
    const probe = () => {
      const sock = net.connect({host: 'localhost', port})
      sock.once('connect', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs)
          return reject(new Error('port still accepting connections'))
        setTimeout(probe, 200)
      })
      sock.once('error', () => {
        sock.destroy()
        resolve()
      })
    }
    probe()
  })

// The config's 4s test timeout is far too tight for booting a sync-server +
// loading two studio pages + syncing, so raise it for this test.
test.setTimeout(60000)

test('two browsers sync via self-hosted sync-server', async ({browser}) => {
  const port = await findOpenPort()
  const server = spawn(
    'yarn',
    [
      'exec',
      'tsx',
      // sync-server's tsconfig holds the `@dreamerbird/utils/*` path aliases; from
      // the repo root tsx wouldn't auto-detect a root tsconfig.json.
      '--tsconfig',
      'packages/sync-server/tsconfig.json',
      'packages/sync-server/src/index.ts',
    ],
    {
      cwd: MONOREPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: 'localhost',
        AUTH_DISABLED: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Make the spawned yarn/tsx/node a process-group leader so SIGTERM
      // below reaches the whole tree; killing the yarn wrapper alone leaves
      // the tsx/node sync-server grandchild running as an orphan.
      detached: true,
    },
  )
  server.stdout.on('data', (d) => process.stdout.write(`[sync-server] ${d}`))
  server.stderr.on('data', (d) => process.stderr.write(`[sync-server] ${d}`))

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  try {
    await waitForServer(port)
    const url = `./shared/sync/?serverUrl=ws://localhost:${port}`
    await pageA.goto(url)
    await pageB.goto(url)
    await expect(pageA.locator('#sync-value')).toHaveText('0')
    await expect(pageB.locator('#sync-value')).toHaveText('0')

    // give the ws subscriptions a moment to establish
    await pageA.waitForTimeout(1000)

    // A edits
    await pageA.locator('#sync-plus').click()
    await expect(pageA.locator('#sync-value')).toHaveText('1')

    // B receives the update in real time (pushed via sync-server)
    await expect(pageB.locator('#sync-value')).toHaveText('1', {
      timeout: 15000,
    })
  } finally {
    if (server.pid) process.kill(-server.pid, 'SIGTERM')
    await ctxA.close().catch(() => {})
    await ctxB.close().catch(() => {})
  }
})

test('connection badge shows on server loss and clears on reconnect', async ({
  browser,
}) => {
  test.setTimeout(90000)
  const port = await findOpenPort()

  const startServer = () => {
    const s = spawn(
      'yarn',
      [
        'exec',
        'tsx',
        '--tsconfig',
        'packages/sync-server/tsconfig.json',
        'packages/sync-server/src/index.ts',
      ],
      {
        cwd: MONOREPO_ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: 'localhost',
          AUTH_DISABLED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    )
    s.stdout.on('data', (d) => process.stdout.write(`[sync-server] ${d}`))
    s.stderr.on('data', (d) => process.stderr.write(`[sync-server] ${d}`))
    return s
  }

  let server = startServer()
  const killServer = () => {
    if (server.pid) process.kill(-server.pid, 'SIGTERM')
  }

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const badge = page.locator('[data-testid="connection-status-badge"]')

  try {
    await waitForServer(port)
    const url = `./shared/sync/?serverUrl=ws://localhost:${port}`
    await page.goto(url)
    await expect(page.locator('#sync-value')).toHaveText('0')

    // connected: the badge is not rendered
    await expect(badge).toHaveCount(0, {timeout: 15000})

    // kill the server → the 1s connection poll flips the badge to reconnecting
    killServer()
    await expect(badge).toHaveCount(1, {timeout: 15000})

    // restart on the same port → trpc's ws client reconnects → badge clears
    await waitForPortDown(port)
    server = startServer()
    await waitForServer(port)
    await expect(badge).toHaveCount(0, {timeout: 15000})
  } finally {
    killServer()
    await ctx.close().catch(() => {})
  }
})
