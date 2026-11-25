import {useEffect, useState} from 'react'
import type {RefObject} from 'react'

const STUDIO_HOST_ID = 'theatrejs-studio-root'
const SEQUENCE_PANEL_SELECTOR = '[data-panel-id="sequenceEditor"]'
const DETAIL_PANEL_SELECTOR = '[data-testid="DetailPanel-Object"]'
const OUTLINE_PANEL_SELECTOR = '.cs-studio-outline'
const GAP_PX = 12
const MIN_PREVIEW_BOTTOM = 60
const DEFAULT_RIGHT = 16
// The navigation gizmo can extend 52px from its center on hover.
const GIZMO_INSET = 52 + GAP_PX
const GIZMO_TOP = 70
export type GizmoLayout = {right: number; top: number}
const DEFAULT_GIZMO_LAYOUT: GizmoLayout = {right: GIZMO_INSET, top: GIZMO_TOP}

function findGizmoLayout(
  viewport: DOMRect,
  left: DOMRect | undefined,
  right: DOMRect | undefined,
  timeline: DOMRect | undefined,
): GizmoLayout | null {
  function visible(rect: DOMRect | undefined) {
    return rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < viewport.right &&
      rect.right > viewport.left &&
      rect.top < viewport.bottom &&
      rect.bottom > viewport.top
      ? rect
      : undefined
  }

  const leftPanel = visible(left)
  const rightPanel = visible(right)
  const bottom = visible(timeline)?.top ?? viewport.bottom
  const initialTop = viewport.top + GIZMO_TOP
  const tops = [initialTop]
  for (const panel of [leftPanel, rightPanel]) {
    if (panel) tops.push(Math.max(initialTop, panel.bottom + GIZMO_INSET))
  }

  function overlaps(rect: DOMRect, top: number) {
    return rect.top < top + GIZMO_INSET && rect.bottom > top - GIZMO_INSET
  }

  // Try the top row first, then the space below either sidebar.
  for (const top of tops.sort((a, b) => a - b)) {
    if (top + GIZMO_INSET > bottom) continue
    const leftEdge =
      leftPanel && overlaps(leftPanel, top) ? leftPanel.right : viewport.left
    const rightEdge =
      rightPanel && overlaps(rightPanel, top) ? rightPanel.left : viewport.right
    if (rightEdge - leftEdge >= 2 * GIZMO_INSET) {
      return {
        right: viewport.right - rightEdge + GIZMO_INSET,
        top: top - viewport.top,
      }
    }
  }

  return null
}

export function previewWidth(viewportWidth: number): number {
  return Math.round(Math.min(viewportWidth * 0.2, 232))
}

/** Measure Studio panels relative to the camera viewport, including embedded hosts. */
export function usePreviewLayout(sceneRef: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({
    bottom: MIN_PREVIEW_BOTTOM,
    right: DEFAULT_RIGHT,
    gizmo: DEFAULT_GIZMO_LAYOUT as GizmoLayout | null,
  })

  useEffect(() => {
    let shadow: ShadowRoot | null = null
    let studioHost: HTMLElement | null = null
    let timeline: HTMLElement | null = null
    let details: HTMLElement | null = null
    let outline: HTMLElement | null = null
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
      panelMutations.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      })
      compute()
    }

    function compute() {
      const nextTimeline =
        shadow?.querySelector<HTMLElement>(SEQUENCE_PANEL_SELECTOR) ?? null
      const nextDetails =
        shadow?.querySelector<HTMLElement>(DETAIL_PANEL_SELECTOR) ?? null
      const nextOutline =
        shadow?.querySelector<HTMLElement>(OUTLINE_PANEL_SELECTOR) ?? null
      if (
        timeline !== nextTimeline ||
        details !== nextDetails ||
        outline !== nextOutline
      ) {
        if (timeline) resize.unobserve(timeline)
        if (details) resize.unobserve(details)
        if (outline) resize.unobserve(outline)
        timeline = nextTimeline
        details = nextDetails
        outline = nextOutline
        if (timeline) resize.observe(timeline)
        if (details) resize.observe(details)
        if (outline) resize.observe(outline)
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
      const gizmo = viewport
        ? findGizmoLayout(
            viewport,
            outline?.getBoundingClientRect(),
            detailRect,
            timelineRect,
          )
        : DEFAULT_GIZMO_LAYOUT
      setLayout((prev) =>
        prev.bottom === bottom &&
        prev.right === right &&
        prev.gizmo?.right === gizmo?.right &&
        prev.gizmo?.top === gizmo?.top
          ? prev
          : {bottom, right, gizmo},
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
