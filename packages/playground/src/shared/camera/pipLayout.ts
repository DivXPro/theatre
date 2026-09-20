import {useEffect, useState} from 'react'

/**
 * 时间轴面板在 studio 的 shadow DOM 里(studio UI 整体挂
 * #theatrejs-studio-root 的开放 shadow root),普通 DOM 选择器够不到,
 * 必须从 host 先进 shadowRoot 再 querySelector。
 */
const STUDIO_HOST_ID = 'theatrejs-studio-root'
const SEQUENCE_PANEL_SELECTOR = '[data-panel-id="sequenceEditor"]'
/** 画中画与时间轴面板之间的空隙 */
const GAP_PX = 12
/** 时间轴收拢(只剩停靠条)时的底部留白 */
const COLLAPSED_BOTTOM_PX = 48

/**
 * 画中画底部留白(px):时间轴面板展开时悬在它上方留 GAP_PX 空隙,
 * 收拢/不存在时回落到 COLLAPSED_BOTTOM_PX。
 * 面板高度可拖拽、可收拢,所以监听尺寸/DOM/窗口变化实时重算。
 */
export function usePipBottom(): number {
  const [bottom, setBottom] = useState(COLLAPSED_BOTTOM_PX)

  useEffect(() => {
    const findPanel = (): HTMLElement | null =>
      document
        .getElementById(STUDIO_HOST_ID)
        ?.shadowRoot?.querySelector<HTMLElement>(SEQUENCE_PANEL_SELECTOR) ??
      null

    const shadowRoot = document.getElementById(STUDIO_HOST_ID)?.shadowRoot
    // 面板高度拖拽 → 尺寸变化;收拢/展开 → DOM 增删(面板元素会重建,
    // ResizeObserver 每次重挂到当前元素上)
    let observed: HTMLElement | null = null
    const resizeObserver = new ResizeObserver(compute)
    const mutationObserver = new MutationObserver(compute)
    if (shadowRoot) {
      mutationObserver.observe(shadowRoot, {subtree: true, childList: true})
    }
    window.addEventListener('resize', compute)
    compute()
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', compute)
    }

    function compute() {
      const panel = findPanel()
      if (panel !== observed) {
        resizeObserver.disconnect()
        if (panel) resizeObserver.observe(panel)
        observed = panel
      }
      if (!panel) {
        setBottom(COLLAPSED_BOTTOM_PX)
        return
      }
      // 面板顶边距屏幕底 = 视口高 - top,再留一条空隙
      setBottom(
        Math.max(
          COLLAPSED_BOTTOM_PX,
          window.innerHeight - panel.getBoundingClientRect().top + GAP_PX,
        ),
      )
    }
  }, [])

  return bottom
}
