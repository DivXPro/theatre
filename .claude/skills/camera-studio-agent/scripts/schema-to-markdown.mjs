#!/usr/bin/env node
/**
 * camera-studio Agent 命令参考生成器(零依赖,Node >= 18)。
 *
 * 用法(与 scene-api.mjs 配套):
 *   scene-api.mjs schema | schema-to-markdown.mjs > references/commands.md
 *
 * stdin 读入 `GET /v1/schema` 的原始 JSON({apiVersion, commands}),
 * stdout 输出 Markdown。契约:
 * - 只复制命令元数据(registry.ts CommandDescription),绝不输出
 *   validate/execute 或任何函数源码;
 * - 命令按 name 排序,同一 schema 输出字节一致(无时间戳);
 * - 畸形 schema(缺 commands/name/inputSchema/outputSchema、重名、
 *   非法 JSON)一律以 INVALID_ARGUMENT JSON 写 stderr、退出码 2,
 *   stdout 不留半截成功文本。
 */

/** 读取完整 stdin(UTF-8 文本)。 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (raw += chunk))
    process.stdin.on('end', () => resolve(raw))
    process.stdin.on('error', reject)
  })
}

function fail(message) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: {code: 'INVALID_ARGUMENT', message, retryable: false},
      },
      null,
      2,
    )}\n`,
  )
  process.exit(2)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 完整校验,任何一项不过即整份失败(无部分输出)。 */
function validateSchema(schema) {
  if (!isPlainObject(schema)) fail('schema 必须是 JSON 对象')
  if (schema.apiVersion === undefined || schema.apiVersion === null) {
    fail('schema 缺少 apiVersion')
  }
  if (!Array.isArray(schema.commands)) fail('schema 缺少 commands 数组')
  const seen = new Set()
  for (const command of schema.commands) {
    if (!isPlainObject(command)) fail('commands 每一项必须是对象')
    if (typeof command.name !== 'string' || command.name === '') {
      fail('命令缺少 name')
    }
    if (seen.has(command.name)) fail(`命令名重复: ${command.name}`)
    seen.add(command.name)
    if (!isPlainObject(command.inputSchema)) {
      fail(`命令 ${command.name} 缺少 inputSchema`)
    }
    if (!isPlainObject(command.outputSchema)) {
      fail(`命令 ${command.name} 缺少 outputSchema`)
    }
  }
}

function jsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
}

function renderCommand(command) {
  const lines = [`## \`${command.name}\``, '']
  lines.push(`- Kind: \`${command.kind}\``)
  lines.push(`- State: \`${command.stateDomain}\``)
  lines.push(`- Undoable: \`${command.undoable}\``)
  if (command.completion !== undefined && command.completion !== null) {
    lines.push(`- Completion: \`${command.completion}\``)
  }
  if (command.cancelable === true) {
    lines.push('- Cancelable: yes')
  }
  lines.push(`- Expected revision: ${command.acceptsExpectedRevision ? 'yes' : 'no'}`)
  lines.push('', '### Input', '', jsonBlock(command.inputSchema))
  lines.push('', '### Output', '', jsonBlock(command.outputSchema))
  if (command.kind === 'job' && command.jobResultSchema !== undefined) {
    lines.push('', '### Job result', '', jsonBlock(command.jobResultSchema))
  }
  if (Array.isArray(command.errorCodes) && command.errorCodes.length > 0) {
    lines.push(
      '',
      '### Errors',
      '',
      command.errorCodes.map((code) => `\`${code}\``).join(', '),
    )
  }
  return lines.join('\n')
}

async function main() {
  const raw = await readStdin()
  let schema
  try {
    schema = JSON.parse(raw)
  } catch {
    fail('stdin 不是合法 JSON')
  }
  validateSchema(schema)

  const header = [
    '# Camera Studio Agent 命令参考',
    '',
    `> 由 schema-to-markdown.mjs 生成,请勿手改。API version: \`${String(schema.apiVersion)}\`。`,
    '',
    '本文件由运行时 schema(`GET /v1/schema`)生成:同一 schema 重复生成字节一致(无时间戳)。重新生成:',
    '',
    '```bash',
    'node .claude/skills/camera-studio-agent/scripts/scene-api.mjs schema \\',
    '  | node .claude/skills/camera-studio-agent/scripts/schema-to-markdown.mjs \\',
    '  > .claude/skills/camera-studio-agent/references/commands.md',
    '```',
    '',
    '---',
    '',
  ].join('\n')

  const commands = [...schema.commands].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
  const body = commands.map(renderCommand).join('\n\n')
  process.stdout.write(`${header}${body}\n`)
}

main().catch((err) => {
  fail(err?.message ?? String(err))
})
