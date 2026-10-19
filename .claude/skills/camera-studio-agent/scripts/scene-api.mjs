#!/usr/bin/env node
/**
 * camera-studio Agent HTTP 客户端(零依赖,Node >= 18 内置模块)。
 *
 * 用法:
 *   scene-api.mjs health
 *   scene-api.mjs schema [command]
 *   scene-api.mjs call <name> <json-args> [--request-id id]
 *   scene-api.mjs upload <path> [--mime type]
 *   scene-api.mjs job <jobId>
 *   scene-api.mjs wait <jobId> [--interval-ms n] [--timeout-ms n]
 *   scene-api.mjs cancel <jobId>
 *   scene-api.mjs download <fileId> <output> [--force]
 *
 * 环境变量:
 *   CAMERA_STUDIO_API_URL  桥接地址,默认 http://127.0.0.1:43110
 *   CAMERA_STUDIO_TOKEN    Bearer Token(必填,绝不打印)
 *
 * stdout 只输出机器可读 JSON(成功为领域结果,--help 除外);
 * 错误一律以 {ok:false,error:{code,message,retryable,details?}} 写到 stderr 并非零退出。
 */

import {randomUUID} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {stat, rename, unlink} from 'node:fs/promises'
import {basename} from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

const baseUrl = (
  process.env.CAMERA_STUDIO_API_URL ?? 'http://127.0.0.1:43110'
).replace(/\/+$/, '')
const token = process.env.CAMERA_STUDIO_TOKEN
const baseOrigin = safeOrigin(baseUrl)

class CliError extends Error {
  constructor(code, message, exitCode, details) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
    this.retryable = details?.retryable ?? false
  }
}

function safeOrigin(raw) {
  try {
    return new URL(raw).origin
  } catch {
    return raw
  }
}

function requireToken() {
  if (!token) {
    throw new CliError('UNAUTHORIZED', 'CAMERA_STUDIO_TOKEN is required', 2)
  }
}

function networkError(cause) {
  return new CliError(
    'NETWORK_ERROR',
    `${cause?.name ?? 'Error'}: ${
      cause?.message ?? String(cause)
    } (origin: ${baseOrigin})`,
    1,
  )
}

function envelopeError(err) {
  return new CliError(
    err?.code ?? 'NETWORK_ERROR',
    err?.message ?? `HTTP error`,
    1,
    err,
  )
}

async function request(path, options = {}) {
  requireToken()
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {...options, headers})
  } catch (cause) {
    throw networkError(cause)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    const error = body?.error ?? {
      code: 'NETWORK_ERROR',
      message: `HTTP ${response.status}`,
      retryable: response.status >= 500,
    }
    throw envelopeError(error)
  }
  return body.result
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function usage(message) {
  return new CliError('USAGE', message, 2)
}

function parseFlags(argv, {booleanFlags = [], valueFlags = []} = {}) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      if (booleanFlags.includes(key)) {
        if (eq !== -1) throw usage(`--${key} does not take a value`)
        flags[key] = true
      } else if (valueFlags.includes(key)) {
        const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1)
        if (value === undefined) throw usage(`--${key} requires a value`)
        if (eq === -1) i += 1
        flags[key] = value
      } else {
        throw usage(`unknown flag: ${arg}`)
      }
    } else {
      positional.push(arg)
    }
  }
  return {flags, positional}
}

function parsePositiveInt(raw, flagName) {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw usage(`--${flagName} must be a positive integer, got: ${raw}`)
  }
  return value
}

async function cmdHealth() {
  return request('/v1/health')
}

async function cmdSchema(command) {
  const schema = await request('/v1/schema')
  if (!command) return schema
  const commands = Array.isArray(schema?.commands)
    ? schema.commands.filter((entry) => entry?.name === command)
    : []
  if (commands.length === 0) {
    throw new CliError(
      'COMMAND_NOT_FOUND',
      `schema has no command: ${command}`,
      1,
    )
  }
  return {...schema, commands}
}

async function cmdCall(name, argsJson, requestId) {
  let args
  try {
    args = JSON.parse(argsJson)
  } catch {
    throw new CliError(
      'INVALID_ARGUMENT',
      `args is not valid JSON: ${argsJson}`,
      2,
    )
  }
  return request('/v1/commands', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      requestId: requestId ?? randomUUID(),
      name,
      args,
    }),
  })
}

async function cmdUpload(filePath, mime) {
  let size
  try {
    size = (await stat(filePath)).size
  } catch {
    throw new CliError('INVALID_ARGUMENT', `cannot read file: ${filePath}`, 2)
  }
  return request('/v1/files', {
    method: 'POST',
    headers: {
      'X-File-Name': encodeURIComponent(basename(filePath)),
      'Content-Type': mime ?? 'application/octet-stream',
      'Content-Length': String(size),
    },
    body: createReadStream(filePath),
    duplex: 'half',
  })
}

async function cmdJob(jobId) {
  return request(`/v1/jobs/${jobId}`)
}

async function cmdWait(jobId, intervalMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const snapshot = await cmdJob(jobId)
    const state = snapshot?.state
    if (state !== 'pending' && state !== 'running') {
      if (state === 'succeeded') return snapshot
      const error = snapshot?.error ?? {
        code: 'JOB_FAILED',
        message: `job ${jobId} ended with state: ${String(state)}`,
        retryable: false,
      }
      throw envelopeError({...error, retryable: error.retryable ?? false})
    }
    if (Date.now() + intervalMs > deadline) {
      throw new CliError(
        'NETWORK_ERROR',
        `timed out after ${timeoutMs}ms waiting for job ${jobId}`,
        1,
        {retryable: true},
      )
    }
    await sleep(intervalMs)
  }
}

async function cmdCancel(jobId) {
  return request(`/v1/jobs/${jobId}/cancel`, {method: 'POST'})
}

async function cmdDownload(fileId, output, force) {
  requireToken()
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)
  let response
  try {
    response = await fetch(`${baseUrl}/v1/files/${fileId}`, {headers})
  } catch (cause) {
    throw networkError(cause)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = body?.error ?? {
      code: 'NETWORK_ERROR',
      message: `HTTP ${response.status}`,
      retryable: response.status >= 500,
    }
    throw envelopeError(error)
  }
  if (!force) {
    const exists = await stat(output).then(
      () => true,
      () => false,
    )
    if (exists) {
      throw new CliError(
        'FILE_EXISTS',
        `refusing to overwrite existing file: ${output} (pass --force)`,
        1,
      )
    }
  }
  const tmpPath = `${output}.part-${randomUUID()}`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath))
  } catch (cause) {
    await unlink(tmpPath).catch(() => {})
    throw new CliError(
      'NETWORK_ERROR',
      `download failed: ${cause?.message ?? String(cause)}`,
      1,
      {retryable: true},
    )
  }
  try {
    await rename(tmpPath, output)
  } catch (cause) {
    await unlink(tmpPath).catch(() => {})
    throw new CliError(
      'CLI_ERROR',
      `cannot write output ${output}: ${cause?.message ?? String(cause)}`,
      1,
    )
  }
  const size = (await stat(output)).size
  return {fileId, output, size}
}

const HELP = `scene-api — camera-studio Agent HTTP 客户端

用法:
  scene-api.mjs health
  scene-api.mjs schema [command]
  scene-api.mjs call <name> <json-args> [--request-id id]
  scene-api.mjs upload <path> [--mime type]
  scene-api.mjs job <jobId>
  scene-api.mjs wait <jobId> [--interval-ms n] [--timeout-ms n]
  scene-api.mjs cancel <jobId>
  scene-api.mjs download <fileId> <output> [--force]

环境变量:
  CAMERA_STUDIO_API_URL   桥接地址(默认 http://127.0.0.1:43110)
  CAMERA_STUDIO_TOKEN     Bearer Token(必填;只从环境变量读取,绝不打印)

输出:
  stdout 只输出机器可读 JSON;错误以 JSON 写到 stderr 并非零退出。
  写命令自动生成 requestId;重试时显式传 --request-id 复用。
  wait 轮询任务到终态后才返回结果。
`

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (
    !command ||
    command === '--help' ||
    command === '-h' ||
    command === 'help'
  ) {
    process.stdout.write(HELP)
    return
  }
  let result
  switch (command) {
    case 'health':
      result = await cmdHealth()
      break
    case 'schema': {
      const {positional} = parseFlags(rest)
      result = await cmdSchema(positional[0])
      break
    }
    case 'call': {
      const {flags, positional} = parseFlags(rest, {
        valueFlags: ['request-id'],
      })
      const [name, argsJson] = positional
      if (!name || argsJson === undefined) {
        throw usage('call requires: <name> <json-args>')
      }
      result = await cmdCall(name, argsJson, flags['request-id'])
      break
    }
    case 'upload': {
      const {flags, positional} = parseFlags(rest, {valueFlags: ['mime']})
      const [filePath] = positional
      if (!filePath) throw usage('upload requires: <path>')
      result = await cmdUpload(filePath, flags.mime)
      break
    }
    case 'job': {
      const {positional} = parseFlags(rest)
      const [jobId] = positional
      if (!jobId) throw usage('job requires: <jobId>')
      result = await cmdJob(jobId)
      break
    }
    case 'wait': {
      const {flags, positional} = parseFlags(rest, {
        valueFlags: ['interval-ms', 'timeout-ms'],
      })
      const [jobId] = positional
      if (!jobId) throw usage('wait requires: <jobId>')
      const intervalMs = flags['interval-ms']
        ? parsePositiveInt(flags['interval-ms'], 'interval-ms')
        : 500
      const timeoutMs = flags['timeout-ms']
        ? parsePositiveInt(flags['timeout-ms'], 'timeout-ms')
        : 60000
      result = await cmdWait(jobId, intervalMs, timeoutMs)
      break
    }
    case 'cancel': {
      const {positional} = parseFlags(rest)
      const [jobId] = positional
      if (!jobId) throw usage('cancel requires: <jobId>')
      result = await cmdCancel(jobId)
      break
    }
    case 'download': {
      const {flags, positional} = parseFlags(rest, {booleanFlags: ['force']})
      const [fileId, output] = positional
      if (!fileId || !output)
        throw usage('download requires: <fileId> <output>')
      result = await cmdDownload(fileId, output, flags.force === true)
      break
    }
    default:
      throw usage(`unknown command: ${command} (see --help)`)
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function toEnvelope(err) {
  const error = {
    code: err?.code ?? 'CLI_ERROR',
    message: err?.message ?? String(err),
    retryable: err?.retryable ?? false,
  }
  if (err?.details !== undefined) error.details = err.details
  return JSON.stringify({ok: false, error}, null, 2)
}

main().catch((err) => {
  if (err instanceof CliError) {
    process.stderr.write(`${toEnvelope(err)}\n`)
    process.exit(err.exitCode)
  }
  process.stderr.write(
    `${toEnvelope(
      new CliError('CLI_ERROR', err?.message ?? String(err), 1),
    )}\n`,
  )
  process.exit(1)
})
