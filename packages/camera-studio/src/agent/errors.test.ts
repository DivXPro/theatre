import {AgentApiError, asAgentApiError} from './errors'

test('errors expose stable machine fields', () => {
  const error = new AgentApiError('REVISION_CONFLICT', 'stale', {
    retryable: false,
    details: {actualRevision: 2},
  })
  expect(error).toMatchObject({
    code: 'REVISION_CONFLICT',
    retryable: false,
    details: {actualRevision: 2},
  })
})

test('asAgentApiError preserves structured errors and wraps unknown exceptions', () => {
  const structured = new AgentApiError('OBJECT_NOT_FOUND', 'gone')
  expect(asAgentApiError(structured)).toBe(structured)

  const wrapped = asAgentApiError(new Error('boom'))
  expect(wrapped).toBeInstanceOf(AgentApiError)
  expect(wrapped).toMatchObject({
    code: 'INTERNAL_ERROR',
    retryable: false,
    details: {cause: 'boom'},
  })

  const wrappedString = asAgentApiError('weird')
  expect(wrappedString).toMatchObject({code: 'INTERNAL_ERROR'})
})
