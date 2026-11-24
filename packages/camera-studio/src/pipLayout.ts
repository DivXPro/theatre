import {useEffect, useState} from 'react'
import type {RefObject} from 'react'

const STUDIO_HOST_ID = 'theatrejs-studio-root'
const SEQUENCE_PANEL_SELECTOR = '[data-panel-id="sequenceEditor"]'
const DETAIL_PANEL_SELECTOR = '[data-testid="DetailPanel-Object"]'
const GAP_PX = 12
const MIN_PREVIEW_BOTTOM = 60
const DEFAULT_RIGHT = 16

export function previewWidth(viewportWidth: number): number {
  return Math.round(Math.min(viewportWidth * 0.2, 232))
}

/** The canvas and DOM preview share their rectangle, even in an embedded host. */
export function usePreviewLayout(sceneRef: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({
    bottom: MIN_PREVIEW_BOTTOM,
    right: DEFAULT_RIGHT,
  })

  useEffect(() => {
    let shadow: ShadowRoot | null = null
    let studioHost: HTMLElement | null = null
    let timeline: HTMLElement | null = null
    let details: HTMLElement | null = null
    const scene = sceneRef.current
    const resize = new ResizeObserver(compute)
    const panelMutations = new MutationObserver(compute)
    const hostMutations = new MutationObserver(connect)

    function connect() {
      const host = document.getElementById(STUDIO_HOST_ID)
      const root = host?.shadowRoot
      if (!root) return
      studioHost = host
      shadow = root
      hostMutations.disconnect()
      panelMutations.observe(root, {subtree: true, childList: true})
      compute()
    }

    function compute() {
      const nextTimeline =
        shadow?.querySelector<HTMLElement>(SEQUENCE_PANEL_SELECTOR) ?? null
      const nextDetails =
        shadow?.querySelector<HTMLElement>(DETAIL_PANEL_SELECTOR) ?? null
      if (timeline !== nextTimeline || details !== nextDetails) {
        if (timeline) resize.unobserve(timeline)
        if (details) resize.unobserve(details)
        timeline = nextTimeline
        details = nextDetails
        if (timeline) resize.observe(timeline)
        if (details) resize.observe(details)
      }

      const viewport = scene?.getBoundingClientRect()
      if (viewport && studioHost) {
        const offset = Math.max(
          0,
          viewport.top - studioHost.getBoundingClientRect().top,
        )
        const top = `${offset}px`
        if (studioHost.style.getPropertyValue('--theatre-camera-top') !== top) {
          studioHost.style.setProperty('--theatre-camera-top', top)
        }
      }
      const timelineRect = timeline?.getBoundingClientRect()
      const detailRect = details?.getBoundingClientRect()
      const bottomClearance = timelineRect?.height
        ? Math.max(
            MIN_PREVIEW_BOTTOM,
            window.innerHeight - timelineRect.top + GAP_PX,
          )
        : MIN_PREVIEW_BOTTOM
      const width = previewWidth(viewport?.width ?? window.innerWidth)
      const inspectorInset =
        viewport && detailRect?.width
          ? viewport.right - detailRect.left + GAP_PX
          : DEFAULT_RIGHT
      const right =
        viewport && viewport.width - inspectorInset >= width + GAP_PX
          ? Math.max(DEFAULT_RIGHT, inspectorInset)
          : DEFAULT_RIGHT
      const bottom = Math.max(
        GAP_PX,
        bottomClearance +
          (viewport?.bottom ?? window.innerHeight) -
          window.innerHeight,
      )
      setLayout((prev) =>
        prev.bottom === bottom && prev.right === right ? prev : {bottom, right},
      )
    }

    if (scene) resize.observe(scene)
    hostMutations.observe(document.body, {subtree: true, childList: true})
    connect()
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      resize.disconnect()
      panelMutations.disconnect()
      hostMutations.disconnect()
      studioHost?.style.removeProperty('--theatre-camera-top')
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [sceneRef])

  return layout
}
