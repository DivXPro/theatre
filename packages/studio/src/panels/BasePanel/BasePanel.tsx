import {prism, val} from '@dreamerbird/dataverse'
import {usePrism} from '@dreamerbird/react'
import type {$IntentionalAny, VoidFn} from '@dreamerbird/core/types/public'
import getStudio from '@dreamerbird/studio/getStudio'
import type {PanelPosition} from '@dreamerbird/core/types/private'
import useLockSet from '@dreamerbird/studio/uiComponents/useLockSet'
import React, {useContext} from 'react'
import useWindowSize from 'react-use/esm/useWindowSize'
import type {UIPanelId} from '@dreamerbird/core/types/private'
import {StudioRootContext} from '@dreamerbird/studio/UIRoot/StudioRootContext'

type PanelStuff = {
  panelId: UIPanelId
  dims: {
    width: number
    height: number
    top: number
    left: number
  }
  minDims: {
    width: number
    height: number
  }
  boundsHighlighted: boolean
  addBoundsHighlightLock: () => VoidFn
  /** 'bottom': docked to the screen bottom, full width. Horizontal placement
   * is forced; only the height comes from the persisted position. */
  docked?: 'bottom'
}

export const panelDimsToPanelPosition = (
  dims: PanelStuff['dims'],
  windowDims: {height: number; width: number},
): PanelPosition => {
  const left = dims.left / windowDims.width
  const right = (dims.left + dims.width) / windowDims.width
  const top = dims.top / windowDims.height
  const bottom = (dims.height + dims.top) / windowDims.height

  const position: PanelPosition = {
    edges: {
      left:
        left <= 0.5
          ? {from: 'screenLeft', distance: left}
          : {from: 'screenRight', distance: 1 - left},

      right:
        right <= 0.5
          ? {from: 'screenLeft', distance: right}
          : {from: 'screenRight', distance: 1 - right},

      top:
        top <= 0.5
          ? {from: 'screenTop', distance: top}
          : {from: 'screenBottom', distance: 1 - top},

      bottom:
        bottom <= 0.5
          ? {from: 'screenTop', distance: bottom}
          : {from: 'screenBottom', distance: 1 - bottom},
    },
  }

  return position
}

const PanelContext = React.createContext<PanelStuff>(null as $IntentionalAny)

export const usePanel = () => useContext(PanelContext)

function usePanelSize(): {width: number; height: number} {
  const windowSize = useWindowSize(800, 200)
  const root = useContext(StudioRootContext)
  const [rootSize, setRootSize] = React.useState(windowSize)

  React.useEffect(() => {
    if (!root) return
    const update = () => {
      const bounds = root.getBoundingClientRect()
      setRootSize({width: bounds.width, height: bounds.height})
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [root, windowSize.width, windowSize.height])

  return root ? rootSize : windowSize
}

const BasePanel: React.FC<{
  panelId: UIPanelId
  defaultPosition: PanelPosition
  minDims: {width: number; height: number}
  docked?: 'bottom'
  dockInsets?: {left: number; right: number; bottom: number}
  defaultDockHeight?: number
  children: React.ReactNode
}> = ({
  panelId,
  children,
  defaultPosition,
  minDims,
  docked,
  dockInsets,
  defaultDockHeight,
}) => {
  const windowSize = usePanelSize()
  const [boundsHighlighted, addBoundsHighlightLock] = useLockSet()

  const {stuff} = usePrism(() => {
    const savedPosition = val(
      getStudio()!.atomP.historic.panelPositions[panelId],
    )
    const {edges} = savedPosition ?? defaultPosition

    let left = Math.floor(
      windowSize.width *
        (edges.left.from === 'screenLeft'
          ? edges.left.distance
          : 1 - edges.left.distance),
    )

    let right = Math.floor(
      windowSize.width *
        (edges.right.from === 'screenLeft'
          ? edges.right.distance
          : 1 - edges.right.distance),
    )

    let top = Math.floor(
      windowSize.height *
        (edges.top.from === 'screenTop'
          ? edges.top.distance
          : 1 - edges.top.distance),
    )

    let bottom = Math.floor(
      windowSize.height *
        (edges.bottom.from === 'screenTop'
          ? edges.bottom.distance
          : 1 - edges.bottom.distance),
    )

    if (docked === 'bottom') {
      // 停靠底边:左右撑满,高度仍取持久化值(顶边拖拽调节),无视历史的
      // 水平位置和顶边位置——那是浮动时代的遗留
      const bottomInset = dockInsets?.bottom ?? 0
      left = dockInsets?.left ?? 0
      right =
        windowSize.width -
        (windowSize.width >= 1050
          ? dockInsets?.right ?? 0
          : dockInsets?.left ?? 0)
      const dockedHeight = Math.min(
        Math.max(
          savedPosition ? bottom - top : defaultDockHeight ?? bottom - top,
          minDims.height,
        ),
        Math.max(0, windowSize.height - bottomInset),
      )
      bottom = windowSize.height - bottomInset
      top = bottom - dockedHeight
    }

    const width =
      docked === 'bottom' ? right - left : Math.max(right - left, minDims.width)
    const height =
      docked === 'bottom'
        ? bottom - top
        : Math.max(bottom - top, minDims.height)

    // memo-ing dims so its ref can be used as a cache key
    const dims = prism.memo(
      'dims',
      () => ({
        width,
        left,
        top,
        height,
      }),
      [width, left, top, height],
    )

    const stuff: PanelStuff = {
      dims: dims,
      panelId,
      minDims,
      boundsHighlighted,
      addBoundsHighlightLock,
      docked,
    }
    return {stuff}
  }, [
    panelId,
    windowSize,
    boundsHighlighted,
    addBoundsHighlightLock,
    docked,
    dockInsets,
    defaultDockHeight,
    defaultPosition,
    minDims,
  ])

  return <PanelContext.Provider value={stuff}>{children}</PanelContext.Provider>
}

export default BasePanel
