export {}

global.__THEATREJS__FORCE_CONNECT_CORE_AND_STUDIO = true

// jsdom has no `navigator.locks`, so `_acquireLocksOnClosedSessions` silently
// skips the crash-recovery path. Install a minimal polyfill so that path is
// exercised in tests. Lock release happens when the callback resolves (the
// `finally` below), matching the real LockManager semantics.
if (!(globalThis.navigator as {locks?: unknown}).locks) {
  const held = new Map<string, {mode: string}>()
  ;(globalThis.navigator as unknown as {locks: unknown}).locks = {
    async request(
      name: string,
      opts: {mode?: string; ifAvailable?: boolean} | undefined,
      cb: (lock: {name: string; mode: string} | null) => Promise<void>,
    ): Promise<void> {
      if (opts?.ifAvailable && held.has(name)) {
        await cb(null)
        return
      }
      held.set(name, {mode: opts?.mode ?? 'exclusive'})
      try {
        await cb({name, mode: 'exclusive'})
      } finally {
        held.delete(name)
      }
    },
    query: async () => ({held: [...held.keys()].map((n) => ({name: n}))}),
  }
}
