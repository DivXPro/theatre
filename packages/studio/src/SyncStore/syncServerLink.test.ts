import SyncServerLink from './SyncServerLink'

const makeFakeWsClient = (initialReadyState: number) => {
  const socket = {readyState: initialReadyState}
  return {
    socket,
    getConnection: () => socket,
  }
}

describe('SyncServerLink connection state', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('emits connected when readyState is OPEN, reconnecting otherwise', () => {
    const fake = makeFakeWsClient(0) // CONNECTING
    const link = new SyncServerLink('ws://localhost:1', {
      createWSClientImpl: () => fake as any,
    })
    const states: string[] = []
    link.onConnectionStateChange((s) => states.push(s))
    expect(states[states.length - 1]).toBe('reconnecting')

    fake.socket.readyState = 1 // OPEN
    jest.advanceTimersByTime(1100)
    expect(states[states.length - 1]).toBe('connected')

    fake.socket.readyState = 3 // CLOSED
    jest.advanceTimersByTime(1100)
    expect(states[states.length - 1]).toBe('reconnecting')
  })

  test('unsub stops emitting', () => {
    const fake = makeFakeWsClient(1)
    const link = new SyncServerLink('ws://localhost:1', {
      createWSClientImpl: () => fake as any,
    })
    const states: string[] = []
    const unsub = link.onConnectionStateChange((s) => states.push(s))
    unsub()
    fake.socket.readyState = 0
    jest.advanceTimersByTime(1100)
    expect(states).toEqual(['connected'])
  })
})
