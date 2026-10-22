/**
 * 首屏就绪闸门(2026-10-22):聚合「工程就绪 + 首批场景资源加载落定」,
 * 就绪前 CameraScene 盖加载遮罩——此前顶栏/轴向控制器等同步部件首帧就画,
 * 模型和面板走各自异步(Suspense fallback=null / 库加载)settled 才补,
 * 开场观感参差。闸门只闸首屏:落定一次后,后续放置/加载不再触发遮盖。
 *
 * 模块级单值通路(与 getLibrary/poseSession 同风格):CameraScene 创建并
 * 安装;PlacementManager 各层经 getFirstScreenGate() 上报,免层层传 prop;
 * 未安装时返回 no-op(测试或宿主绕过 CameraScene 直用 PlacementManager 不炸)。
 */
export interface FirstScreenGate {
  /** 工程就绪(useProjectReady 变真时调;幂等) */
  setProjectReady(): void
  /** 登记一个首屏要等的资源;已落定过的 key 不重复登记(清单重扫防回加) */
  expect(key: string): void
  /** 上报一个资源落定(加载成功或失败都算;未登记的 key 忽略) */
  settle(key: string): void
  /** 落定后 expect/settle 全是 no-op */
  readonly fired: boolean
}

export const FIRST_SCREEN_TIMEOUT_MS = 15000

export function createFirstScreenGate(
  onReady: () => void,
  timeoutMs: number = FIRST_SCREEN_TIMEOUT_MS,
  warn: (msg: string) => void = console.warn,
): FirstScreenGate {
  const pending = new Set<string>()
  const settled = new Set<string>()
  let projectReady = false
  let fired = false
  // 兜底:某个资源悬挂(网络卡死等)不能让用户永远看遮罩,超时强制揭幕
  const timer = setTimeout(() => {
    warn(
      `[firstScreen] 首屏等待超过 ${timeoutMs}ms 强制揭幕(未落定:${
        [...pending].join(', ') || '无'
      };工程就绪:${projectReady})`,
    )
    fire()
  }, timeoutMs)
  // Node 的 Timeout 才有 unref(浏览器返回 number):防测试进程被计时器挂住
  if (typeof timer === 'object' && typeof timer.unref === 'function') {
    timer.unref()
  }
  function fire() {
    if (fired) return
    fired = true
    clearTimeout(timer)
    onReady()
  }
  function check() {
    if (projectReady && pending.size === 0) fire()
  }
  return {
    get fired() {
      return fired
    },
    setProjectReady() {
      projectReady = true
      check()
    },
    expect(key) {
      if (fired || settled.has(key)) return
      pending.add(key)
    },
    settle(key) {
      if (fired || !pending.has(key)) return
      pending.delete(key)
      settled.add(key)
      check()
    },
  }
}

/** 未安装时的默认闸门:fired=true 的 no-op,上报全部吞掉 */
const noopGate: FirstScreenGate = {
  fired: true,
  setProjectReady() {},
  expect() {},
  settle() {},
}

let current: FirstScreenGate = noopGate

/** CameraScene 装配期调用(必须在子树 effect 之前,见调用点注释) */
export function installFirstScreenGate(gate: FirstScreenGate): void {
  current = gate
}

export function getFirstScreenGate(): FirstScreenGate {
  return current
}

/** CameraScene 卸载/测试复位用 */
export function resetFirstScreenGate(): void {
  current = noopGate
}
