import {isDirectSyncServerUrl} from './syncServerUrl'

describe('isDirectSyncServerUrl', () => {
  test('ws:// and wss:// are direct', () => {
    expect(isDirectSyncServerUrl('ws://localhost:3000')).toBe(true)
    expect(isDirectSyncServerUrl('wss://sync.example.com')).toBe(true)
  })
  test('http(s):// and others are not direct', () => {
    expect(isDirectSyncServerUrl('http://localhost:3000')).toBe(false)
    expect(isDirectSyncServerUrl('https://app.example.com')).toBe(false)
  })
})
