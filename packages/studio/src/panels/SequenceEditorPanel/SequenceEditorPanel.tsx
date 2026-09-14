import {outlineSelection} from '@dreamerbird/studio/selectors'
import {usePrism} from '@dreamerbird/react'
import {valToAtom} from '@dreamerbird/utils/valToAtom'
import {prism, val} from '@dreamerbird/dataverse'
import React, {useState} from 'react'
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
import {uniq} from 'lodash-es'
import GraphEditorToggle from './GraphEditorToggle'
import {panelZIndexes} from '@dreamerbird/studio/panels/BasePanel/common'
import {usePresenceListenersOnRootElement} from '@dreamerbird/studio/uiComponents/usePresence'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import getStudio from '@dreamerbird/studio/getStudio'
import type {UIPanelId} from '@dreamerbird/core/types/private'
import {__private} from '@dreamerbird/core'
const {isSheet, isSheetObject} = __private.instanceTypes

const Container = styled(PanelWrapper)`
  z-index: ${panelZIndexes.sequenceEditorPanel};
  box-shadow: 2px 2px 0 rgb(0 0 0 / 11%);
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
const ContentBody = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: ${transportBarHeight}px;
`

// 收拢后的停靠条:贴屏幕底边撑满,只剩一行工具条
const CollapsedDock = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: ${panelZIndexes.sequenceEditorPanel};
  background-color: #25272b;
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

/** 时间轴要显示的 sheet:大纲选中项能定位到唯一 sheet 就用它,否则回退到
 *  项目的第一个 sheet——面板始终显示,不随选中状态消失 */
function useSelectedSheet(): Sheet | undefined {
  return usePrism(() => {
    const selectedSheets = uniq(
      outlineSelection
        .getValue()
        .filter((s): s is SheetObject | Sheet => isSheet(s) || isSheetObject(s))
        .map((s) => (isSheetObject(s) ? s.sheet : s)),
    )
    const selectedTemplates = uniq(selectedSheets.map((s) => s.template))
    if (selectedTemplates.length === 1) return selectedSheets[0]

    const projects = val(getStudio().projectsP)
    const project = projects[Object.keys(projects)[0]]
    if (!project) return undefined
    const templates = val(project.sheetTemplatesP)
    const template = templates[Object.keys(templates)[0]]
    if (!template) return undefined
    const instances = val(template.instancesP)
    return instances[Object.keys(instances)[0]]
  }, [])
}

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
    }
    return false
  }, [sheet])
}

const SequenceEditorPanel: React.FC<{}> = (props) => {
  // 收拢状态只是临时 UI 态,不进历史(不想产生撤销步)、不持久化。
  // null = 用户没手动切换过,跟随默认:没有任何关键帧轨道时收拢,有轨道时展开;
  // 一旦用户点过收拢/展开按钮,就以用户的选择为准
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(
    null,
  )
  const sheet = useSelectedSheet()
  const hasAnyTracks = useHasAnyTracks(sheet)
  const collapsed = collapsedOverride ?? !hasAnyTracks

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
    >
      <Content sheet={sheet} onCollapse={() => setCollapsedOverride(true)} />
    </BasePanel>
  )
}

const Content: React.FC<{
  sheet: Sheet | undefined
  onCollapse: () => void
}> = ({sheet, onCollapse}) => {
  const {dims} = usePanel()
  const [containerNode, setContainerNode] = useState<null | HTMLDivElement>(
    null,
  )
  usePresenceListenersOnRootElement(containerNode)
  return usePrism(() => {
    const panelSize = prism.memo(
      'panelSize',
      (): PanelDims => {
        // 顶部让出工具条一行,其余交给原布局
        const width = dims.width
        const height = dims.height - transportBarHeight
        return {
          width: width,
          height: height,

          widthWithoutBorder: width - 2,
          heightWithoutBorder: height - 4,

          screenX: dims.left,
          screenY: dims.top + transportBarHeight,
        }
      },
      [dims],
    )

    if (!sheet) return <></>

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
        <ContentBody>
          <LeftBackground style={{width: `${val(layoutP.leftDims.width)}px`}} />
          <FrameStampPositionProvider layoutP={layoutP}>
            <DopeSheet key={key + '-dopeSheet'} layoutP={layoutP} />
            {graphEditorOpen && (
              <GraphEditor key={key + '-graphEditor'} layoutP={layoutP} />
            )}
            {graphEditorAvailable && <GraphEditorToggle layoutP={layoutP} />}
            <RightOverlay layoutP={layoutP} />
          </FrameStampPositionProvider>
        </ContentBody>
      </Container>
    )
  }, [dims, containerNode, sheet, onCollapse])
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
