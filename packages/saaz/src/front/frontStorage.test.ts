import {FrontStorage} from './FrontStorage'
import {FrontMemoryAdapter} from './FrontMemoryAdapter'

test('getAllExistingSessionIds returns sessions that have written a sessionState', async () => {
  const storage = new FrontStorage('db', new FrontMemoryAdapter())
  await storage.transaction(async (t) => {
    await t.setSessionState(
      {
        backendClock: 0,
        lastIncorporatedPeerClock: null,
        lastSyncTime: null,
        peerId: 'peerA',
        snapshot: null,
      },
      'peerA',
    )
  })
  const ids = await storage.transaction((t) => t.getAllExistingSessionIds())
  expect(ids).toContain('peerA')
})
