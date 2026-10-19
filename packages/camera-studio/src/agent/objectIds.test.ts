import {formatSceneObjectId, parseSceneObjectId} from './objectIds'
import {AgentApiError} from './errors'

test('round trips typed ids and preserves additional colons in keys', () => {
  const id = formatSceneObjectId('model', 'Rig:Left')
  expect(id).toBe('model:Rig:Left')
  expect(parseSceneObjectId(id)).toEqual({kind: 'model', key: 'Rig:Left'})
})

test.each(['unknown:x', 'model:', 'model'])('rejects %s', (value) => {
  expect(() => parseSceneObjectId(value)).toThrow(AgentApiError)
})
