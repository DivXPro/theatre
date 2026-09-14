import {prism, val} from '@dreamerbird/dataverse'
import {usePrism} from '@dreamerbird/react'
import type {$IntentionalAny, VoidFn} from '@dreamerbird/core/types/public'
import getStudio from '@dreamerbird/studio/getStudio'
import type {PanelPosition} from '@dreamerbird/core/types/private'
import useLockSet from '@dreamerbird/studio/uiComponents/useLockSet'
import React, {useContext} from 'react'
import useWindowSize from 'react-use/esm/useWindowSize'
import type {UIPanelId} from '@dreamerbird/core/types/private'

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

const BasePanel: React.FC<{
  panelId: UIPanelId
  defaultPosition: PanelPosition
  minDims: {width: number; height: number}
  docked?: 'bottom'
  children: React.ReactNode
}> = ({panelId, children, defaultPosition, minDims, docked}) => {
  const windowSize = useWindowSize(800, 200)
  const [boundsHighlighted, addBoundsHighlightLock] = useLockSet()

  const {stuff} = usePrism(() => {
    const {edges} =
      val(getStudio()!.atomP.historic.panelPositions[panelId]) ??
      defaultPosition

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
      left = 0
      right = windowSize.width
      const dockedHeight = Math.min(
        Math.max(bottom - top, minDims.height),
        windowSize.height,
      )
      top = windowSize.height - dockedHeight
      bottom = windowSize.height
    }

    const width = Math.max(right - left, minDims.width)
    const height = Math.max(bottom - top, minDims.height)

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
  }, [panelId, windowSize, boundsHighlighted, addBoundsHighlightLock, docked])

  return <PanelContext.Provider value={stuff}>{children}</PanelContext.Provider>
}

export default BasePanel
