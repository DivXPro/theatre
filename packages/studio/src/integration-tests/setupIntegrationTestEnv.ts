export {}

global.__THEATREJS__FORCE_CONNECT_CORE_AND_STUDIO = true

// jsdom has no `navigator.locks`, so `_acquireLocksOnClosedSessions` silently
// skips the crash-recovery path. Install a minimal polyfill so that path is
// exercised in tests. Lock release happens when the callback resolves (the
// `finally` below), matching the real LockManager semantics.
//
// Node ≥21 有全局 navigator,Node ≤20(CI 用的 20.9)没有——这套 setup 也跑在
// node 环境的测试(bridge/camera-studio)里,没有就先造一个空壳再装 polyfill。
const navHolder = globalThis as {navigator?: unknown}
if (!navHolder.navigator) {
  navHolder.navigator = {}
}
if (!(navHolder.navigator as {locks?: unknown}).locks) {
  const held = new Map<string, {mode: string}>()
  ;(navHolder.navigator as {locks: unknown}).locks = {
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
