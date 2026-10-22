import {createFirstScreenGate} from './firstScreenGate'

describe('createFirstScreenGate', () => {
  it('工程就绪且无可等资源 → 立即落定', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    expect(onReady).not.toHaveBeenCalled()
    gate.setProjectReady()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(gate.fired).toBe(true)
  })

  it('有待载资源:全部 settle 且工程就绪才落定(先载完后就绪也成立)', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    gate.expect('a')
    gate.expect('b')
    gate.settle('a')
    gate.settle('b')
    expect(onReady).not.toHaveBeenCalled() // 工程未就绪
    gate.setProjectReady()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('部分 settle 不落定', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    gate.expect('a')
    gate.expect('b')
    gate.setProjectReady()
    gate.settle('a')
    expect(onReady).not.toHaveBeenCalled()
    gate.settle('b')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('未登记的 settle 被忽略,不影响计数', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    gate.expect('a')
    gate.settle('陌生人')
    gate.setProjectReady()
    expect(onReady).not.toHaveBeenCalled()
    gate.settle('a')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('已落定的 key 再 expect 不回加(放置清单重扫场景)', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    gate.expect('a')
    gate.setProjectReady()
    gate.settle('a')
    expect(onReady).toHaveBeenCalledTimes(1)
    // 清单重扫又把 a 登记一遍 + 新条目 b —— 闸门已落定,全部忽略
    gate.expect('a')
    gate.expect('b')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('落定只触发一次(setProjectReady/settle 重复调用幂等)', () => {
    const onReady = jest.fn()
    const gate = createFirstScreenGate(onReady)
    gate.setProjectReady()
    gate.setProjectReady()
    gate.settle('从未登记')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('超时强制揭幕并告警,之后不再重复触发', () => {
    jest.useFakeTimers()
    try {
      const onReady = jest.fn()
      const warn = jest.fn()
      const gate = createFirstScreenGate(onReady, 5000, warn)
      gate.expect('卡住的模型')
      jest.advanceTimersByTime(5000)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('卡住的模型')
      expect(onReady).toHaveBeenCalledTimes(1)
      // 超时后迟到的 settle 不再触发
      gate.settle('卡住的模型')
      jest.advanceTimersByTime(10000)
      expect(onReady).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
