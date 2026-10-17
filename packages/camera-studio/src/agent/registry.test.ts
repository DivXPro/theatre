import {AgentCommandRegistry} from './registry'
import {AgentApiError} from './errors'

const context = {requestId: 'r1', signal: new AbortController().signal}

test('validates args and returns the domain result', async () => {
  const registry = new AgentCommandRegistry()
  registry.register({
    name: 'test.double',
    kind: 'query',
    stateDomain: 'transport',
    undoable: 'none',
    inputSchema: {type: 'object'},
    outputSchema: {type: 'number'},
    errorCodes: [],
    validate: (value) => {
      if (typeof value !== 'number') {
        throw new AgentApiError('INVALID_ARGUMENT', 'number expected')
      }
      return value
    },
    execute: async (value) => value * 2,
  })
  await expect(registry.execute('test.double', 3, context)).resolves.toBe(6)
  await expect(
    registry.execute('test.double', '3', context),
  ).rejects.toMatchObject({code: 'INVALID_ARGUMENT'})
  const description = registry.describe()
  expect(description.apiVersion).toBe(1)
  expect(description.commands[0]).toMatchObject({name: 'test.double'})
  expect(description.commands[0]).not.toHaveProperty('execute')
  expect(description.commands[0]).not.toHaveProperty('validate')
})

test('rejects duplicate and unknown commands', async () => {
  const registry = new AgentCommandRegistry()
  await expect(registry.execute('missing', {}, context)).rejects.toMatchObject({
    code: 'COMMAND_NOT_FOUND',
  })

  const definition = {
    name: 'test.double',
    kind: 'query' as const,
    stateDomain: 'transport' as const,
    undoable: 'none' as const,
    inputSchema: {type: 'object'},
    outputSchema: {type: 'number'},
    errorCodes: [],
    validate: (value: unknown) => {
      if (typeof value !== 'number') {
        throw new AgentApiError('INVALID_ARGUMENT', 'number expected')
      }
      return value
    },
    execute: async (value: number) => value * 2,
  }
  registry.register(definition)
  expect(() => registry.register(definition)).toThrowError(
    expect.objectContaining({code: 'INVALID_STATE'}),
  )
})

test('describe() sorts commands by name and marks acceptsExpectedRevision', () => {
  const registry = new AgentCommandRegistry()
  const makeDefinition = (
    name: string,
    stateDomain: 'project' | 'transport',
  ) => ({
    name,
    kind: 'mutation' as const,
    stateDomain,
    undoable: 'single-step' as const,
    inputSchema: {type: 'object'},
    outputSchema: {type: 'object'},
    errorCodes: [],
    validate: (value: unknown) => value as Record<string, unknown>,
    execute: async (value: unknown) => value as Record<string, unknown>,
  })
  registry.register(makeDefinition('test.beta', 'project'))
  registry.register(makeDefinition('test.alpha', 'project'))

  const description = registry.describe()
  expect(description.commands.map((command) => command.name)).toEqual([
    'test.alpha',
    'test.beta',
  ])
  expect(description.commands[0]).toMatchObject({acceptsExpectedRevision: true})
  for (const command of description.commands) {
    expect(command).not.toHaveProperty('execute')
    expect(command).not.toHaveProperty('validate')
  }

  const query = makeDefinition('test.gamma', 'project')
  registry.register({...query, kind: 'query'})
  expect(
    registry.describe().commands.find((c) => c.name === 'test.gamma'),
  ).toMatchObject({
    acceptsExpectedRevision: false,
  })

  expect(registry.has('test.alpha')).toBe(true)
  expect(registry.has('test.missing')).toBe(false)
})

test('execute wraps unknown errors as INTERNAL_ERROR', async () => {
  const registry = new AgentCommandRegistry()
  registry.register({
    name: 'test.boom',
    kind: 'query',
    stateDomain: 'transport',
    undoable: 'none',
    inputSchema: {type: 'object'},
    outputSchema: {type: 'object'},
    errorCodes: [],
    validate: (value) => value as Record<string, unknown>,
    execute: async () => {
      throw new Error('boom')
    },
  })
  await expect(
    registry.execute('test.boom', {}, context),
  ).rejects.toMatchObject({
    code: 'INTERNAL_ERROR',
    details: {cause: 'boom'},
  })
})
