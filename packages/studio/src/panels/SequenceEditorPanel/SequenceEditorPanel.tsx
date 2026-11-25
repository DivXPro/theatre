import {outlineSelection, timelineSheet} from '@dreamerbird/studio/selectors'
import {usePrism, useVal} from '@dreamerbird/react'
import {valToAtom} from '@dreamerbird/utils/valToAtom'
import {prism, val} from '@dreamerbird/dataverse'
import React, {useEffect, useLayoutEffect, useState} from 'react'
import styled from 'styled-components'

import DopeSheet from './DopeSheet/DopeSheet'
import GraphEditor from './GraphEditor/GraphEditor'
import type {PanelDims} from './layout/layout'
import {sequenceEditorPanelLayout} from './layout/layout'
import RightOverlay from './RightOverlay/RightOverlay'
import BasePanel, {
  usePanel,
} from '@dreamerbird/studio/panels/BasePanel/BasePanel'
import type {PanelPosition} from '@dreamerbird/core/types/private'
import PanelWrapper from '@dreamerbird/studio/panels/BasePanel/PanelWrapper'
import FrameStampPositionProvider from './FrameStampPositionProvider'
import TransportBar, {transportBarHeight} from './TransportBar'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import type Sheet from '@dreamerbird/core/sheets/Sheet'
import GraphEditorToggle from './GraphEditorToggle'
import {panelZIndexes} from '@dreamerbird/studio/panels/BasePanel/common'
import {usePresenceListenersOnRootElement} from '@dreamerbird/studio/uiComponents/usePresence'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import type {UIPanelId} from '@dreamerbird/core/types/private'
import {__private} from '@dreamerbird/core'
import {
  additionalRowCountsAsTrack,
  getAdditionalSequenceRows,
  getSequenceEditorView,
  onRevealAdditionalSequenceRows,
} from './additionalRows'
const {isSheetObject} = __private.instanceTypes

const Container = styled(PanelWrapper)`
  z-index: ${panelZIndexes.sequenceEditorPanel};
  border-radius: var(--theatre-panel-radius);
  background: var(--theatre-panel-bg-95);
  box-shadow: inset 0 0 0 1px var(--theatre-panel-border);
`

const LeftBackground = styled.div`
  background-color: var(--theatre-panel-bg-99);
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: -1;
  pointer-events: none;
`

// 工具条之下是原布局的全部内容:内部组件都按绝对定位排,套一层偏移容器
// 就不用动 tree/layout 里那套纵向坐标
const ContentBody = styled.div<{$sidebarWidth: number; $offset?: number}>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: ${({$offset = transportBarHeight}) => $offset}px;
  border-radius: 0 0 var(--theatre-panel-radius) var(--theatre-panel-radius);
  overflow: clip;
  display: grid;
  grid-template-columns: minmax(0, 1fr) ${({$sidebarWidth}) => $sidebarWidth}px;
`

const TimelineArea = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
`

const EditorTimelineArea = styled(TimelineArea)`
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--theatre-panel-bg-99);
`

const TimelineSidebar = styled.aside`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--theatre-panel-bg-99);
  border-left: 1px solid var(--theatre-panel-border, #555);
`

// 收拢后的停靠条:贴屏幕底边撑满,只剩一行工具条
const CollapsedDock = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: ${panelZIndexes.sequenceEditorPanel};
  background-color: var(--theatre-panel-bg-95);
  border-radius: var(--theatre-panel-radius);
  overflow: clip;
  ${pointerEventsAutoInNormalMode};
`

export const zIndexes = (() => {
  const s = {
    rightBackground: 0,
    scrollableArea: 0,
    rightOverlay: 0,
    lengthIndicatorCover: 0,
    lengthIndicatorStrip: 0,
    playhead: 0,
    currentFrameStamp: 0,
    marker: 0,
    horizontalScrollbar: 0,
  }

  // sort the z-indexes
  let i = -1
  for (const key of Object.keys(s)) {
    s[key] = i
    i++
  }

  return s
})()

const defaultPosition: PanelPosition = {
  edges: {
    left: {from: 'screenLeft', distance: 0},
    right: {from: 'screenRight', distance: 0},
    top: {from: 'screenBottom', distance: 0.4},
    bottom: {from: 'screenBottom', distance: 0},
  },
}

const minDims = {width: 800, height: 200}

/** 场景里是否已有任何关键帧轨道(与时间轴树的口径一致:不含 hideFromOutline
 *  的纯数据对象)——一条都没有时,时间轴默认收拢成一行工具条 */
function useHasAnyTracks(sheet: Sheet | undefined): boolean {
  return usePrism(() => {
    if (!sheet) return false
    for (const obj of Object.values(val(sheet.objectsP))) {
      if (!obj || obj.template.hideFromOutline) continue
      const trackSetups = val(
        obj.template.getMapOfValidSequenceTracks_forStudio(),
      )
      if (Object.keys(trackSetups).length > 0) return true
      if (
        getAdditionalSequenceRows(obj.publicApi).some(
          additionalRowCountsAsTrack,
        )
      )
        return true
    }
    return false
  }, [sheet])
}

const SequenceEditorPanel: React.FC<{
  onDockTopChange?: (top: number | undefined) => void
}> = ({onDockTopChange}) => {
  // 收拢状态只是临时 UI 态,不进历史(不想产生撤销步)、不持久化。
  // null = 用户没手动切换过,跟随默认:没有任何关键帧轨道时收拢,有轨道时展开;
  // 一旦用户点过收拢/展开按钮,就以用户的选择为准
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(
    null,
  )
  useEffect(
    () => onRevealAdditionalSequenceRows(() => setCollapsedOverride(false)),
    [],
  )
  const sheet = useVal(timelineSheet)
  const hasAnyTracks = useHasAnyTracks(sheet)
  const hasFocusedObject = usePrism(
    () =>
      outlineSelection
        .getValue()
        .some((item) => isSheetObject(item) && item.sheet === sheet),
    [sheet],
  )
  const editorView = usePrism(
    () =>
      sheet ? getSequenceEditorView(sheet.getSequence().publicApi) : undefined,
    [sheet],
  )
  const collapsed =
    !editorView && (collapsedOverride ?? (!hasAnyTracks && !hasFocusedObject))

  if (collapsed) {
    return (
      <CollapsedDock>
        <TransportBar
          sheet={sheet}
          collapsed
          onToggle={() => setCollapsedOverride(false)}
        />
      </CollapsedDock>
    )
  }

  return (
    <BasePanel
      panelId={'sequenceEditor' as UIPanelId}
      defaultPosition={defaultPosition}
      minDims={minDims}
      docked="bottom"
      dockInsets={{
        left: 12,
        right: 12,
        bottom: 12,
      }}
      defaultDockHeight={210}
    >
      <Content
        sheet={sheet}
        onCollapse={() => setCollapsedOverride(true)}
        onDockTopChange={onDockTopChange}
        editorView={editorView}
      />
    </BasePanel>
  )
}

const Content: React.FC<{
  sheet: Sheet | undefined
  onCollapse: () => void
  onDockTopChange?: (top: number | undefined) => void
  editorView: ReturnType<typeof getSequenceEditorView>
}> = ({sheet, onCollapse, onDockTopChange, editorView}) => {
  const {dims} = usePanel()
  useLayoutEffect(() => {
    onDockTopChange?.(sheet ? dims.top : undefined)
  }, [sheet, dims.top, onDockTopChange])
  useLayoutEffect(() => () => onDockTopChange?.(undefined), [onDockTopChange])
  const [containerNode, setContainerNode] = useState<null | HTMLDivElement>(
    null,
  )
  usePresenceListenersOnRootElement(containerNode)
  return usePrism(() => {
    if (!sheet) return <></>

    if (editorView) {
      return (
        <Container>
          <ContentBody
            $sidebarWidth={Math.min(320, Math.floor(dims.width * 0.45))}
            $offset={0}
          >
            <EditorTimelineArea data-sequence-editor-tracks="">
              {editorView.timeline}
            </EditorTimelineArea>
            <TimelineSidebar data-sequence-editor-sidebar="">
              {editorView.sidebar}
            </TimelineSidebar>
          </ContentBody>
        </Container>
      )
    }

    const selectedObject = outlineSelection
      .getValue()
      .find(
        (item): item is SheetObject =>
          isSheetObject(item) && item.sheet === sheet,
      )
    const sidebar = selectedObject
      ? getAdditionalSequenceRows(selectedObject.publicApi)
          .map((row) => row.renderSidebar?.())
          .find(Boolean)
      : null
    const sidebarWidth = sidebar
      ? Math.min(280, Math.floor(dims.width * 0.45))
      : 0
    const panelSize = prism.memo(
      'panelSize',
      (): PanelDims => {
        // 顶部让出工具条一行,其余交给原布局
        const width = dims.width - sidebarWidth
        const height = dims.height - transportBarHeight
        return {
          width: width,
          height: height,

          widthWithoutBorder: Math.max(0, width - 2),
          heightWithoutBorder: Math.max(0, height - 4),

          screenX: dims.left,
          screenY: dims.top + transportBarHeight,
        }
      },
      [dims, sidebarWidth],
    )

    const panelSizeP = valToAtom('panelSizeP', panelSize).pointer

    // We make a unique key based on the sheet's address, so that
    // <Left /> and <Right />
    // don't have to listen to changes in sheet
    const key = prism.memo('key', () => JSON.stringify(sheet.address), [sheet])

    const layoutP = prism
      .memo(
        'layout',
        () => {
          return sequenceEditorPanelLayout(sheet, panelSizeP)
        },
        [sheet, panelSizeP],
      )
      .getValue()

    // 注意:tree.children 为空(全场景还没有任何关键帧轨道)不再隐藏面板——
    // 时间轴常驻,空轨道时就只显示 sheet 行和工具条
    const containerRef = prism.memo(
      'containerRef',
      preventHorizontalWheelEvents,
      [],
    )

    const graphEditorAvailable = val(layoutP.graphEditorDims.isAvailable)
    const graphEditorOpen = val(layoutP.graphEditorDims.isOpen)

    return (
      <Container
        ref={(elt) => {
          containerRef(elt as HTMLDivElement)
          if (elt !== containerNode) {
            setContainerNode(elt as HTMLDivElement)
          }
        }}
      >
        <TransportBar sheet={sheet} collapsed={false} onToggle={onCollapse} />
        <ContentBody $sidebarWidth={sidebarWidth} $offset={transportBarHeight}>
          <TimelineArea data-sequence-editor-tracks="">
            <LeftBackground
              style={{width: `${val(layoutP.leftDims.width)}px`}}
            />
            <FrameStampPositionProvider layoutP={layoutP}>
              <DopeSheet key={key + '-dopeSheet'} layoutP={layoutP} />
              {graphEditorOpen && (
                <GraphEditor key={key + '-graphEditor'} layoutP={layoutP} />
              )}
              {graphEditorAvailable && <GraphEditorToggle layoutP={layoutP} />}
              <RightOverlay layoutP={layoutP} />
            </FrameStampPositionProvider>
          </TimelineArea>
          {sidebar && (
            <TimelineSidebar data-sequence-editor-sidebar="">
              {sidebar}
            </TimelineSidebar>
          )}
        </ContentBody>
      </Container>
    )
  }, [dims, containerNode, sheet, onCollapse, editorView])
}

export default SequenceEditorPanel

const preventHorizontalWheelEvents = () => {
  let lastNode: null | HTMLElement = null
  const listenerOptions = {
    passive: false,
    capture: false,
  }

  const receiveWheelEvent = (event: WheelEvent) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (node: HTMLElement | null) => {
    if (lastNode !== node && lastNode) {
      lastNode.removeEventListener('wheel', receiveWheelEvent, listenerOptions)
    }
    lastNode = node
    if (node) {
      node.addEventListener('wheel', receiveWheelEvent, listenerOptions)
    }
  }
}
