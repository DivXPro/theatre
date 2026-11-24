import {outlineSelection} from '@dreamerbird/studio/selectors'
import {objectDisplayNameOf} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/displayName'
import {usePrism, useVal} from '@dreamerbird/react'
import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react'
import styled from 'styled-components'
import {
  panelZIndexes,
  TitleBar_Piece,
  TitleBar_Punctuation,
} from '@dreamerbird/studio/panels/BasePanel/common'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import ObjectDetails from './ObjectDetails'
import getStudio from '@dreamerbird/studio/getStudio'
import useHotspot from '@dreamerbird/studio/uiComponents/useHotspot'
import {Atom, prism, val} from '@dreamerbird/dataverse'
import useLockSet from '@dreamerbird/studio/uiComponents/useLockSet'
import {usePresenceListenersOnRootElement} from '@dreamerbird/studio/uiComponents/usePresence'
import {__private} from '@dreamerbird/core'
import {useT} from '@dreamerbird/studio/i18n'
import {transportBarHeight} from '@dreamerbird/studio/panels/SequenceEditorPanel/TransportBar'
const {isSheetObject} = __private.instanceTypes

const headerHeight = 37
const panelTop = 52

const Container = styled.div<{$pin: boolean; $dockTop?: number}>`
  ${pointerEventsAutoInNormalMode};
  background-color: var(--theatre-panel-bg-80);
  position: fixed;
  right: 12px;
  --inspector-top: ${panelTop}px;
  top: var(--inspector-top);
  // Temporary, see comment about CSS grid in SingleRowPropEditor.
  width: min(306px, calc(100% - 24px));
  height: fit-content;
  --timeline-top: ${({$dockTop}) =>
    $dockTop === undefined
      ? `calc(100% - ${transportBarHeight + 12}px)`
      : `${$dockTop}px`};
  max-height: max(0px, calc(var(--timeline-top) - var(--inspector-top) - 12px));
  flex-direction: column;
  overflow: hidden;
  z-index: ${panelZIndexes.propsPanel};

  box-shadow:
    0 1px 1px var(--theatre-shadow-color),
    0 2px 6px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(14px);
  border: 1px solid var(--theatre-panel-border);
  border-radius: var(--theatre-panel-radius);
  box-sizing: border-box;

  display: ${({$pin}) => ($pin ? 'flex' : 'none')};

  &:hover {
    display: flex;
  }

  @media (max-width: 859px) {
    --inspector-top: 94px;
    width: min(294px, calc(100% - 24px));
  }

  :host([data-camera-workspace]) & {
    right: var(--theatre-camera-panel-inset);
    --inspector-top: var(--theatre-camera-panel-top);
    width: min(
      var(--theatre-camera-inspector-width),
      calc(
        100% - var(--theatre-camera-sidebar-width) - 3 *
          var(--theatre-camera-panel-inset)
      )
    );
  }

  @supports not (backdrop-filter: blur()) {
    background: var(--theatre-panel-bg-95);
  }
`

const Title = styled.div`
  margin: 0 10px;
  color: var(--theatre-text-muted);
  font-weight: 500;
  font-size: 11px;
  user-select: none;
  ${pointerEventsAutoInNormalMode};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Header = styled.div`
  height: ${headerHeight}px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--theatre-panel-border);
`

const Heading = styled.span`
  flex: none;
  padding-left: 10px;
  color: var(--theatre-text-primary);
  font-weight: 600;
`

const Body = styled.div`
  ${pointerEventsAutoInNormalMode};
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--theatre-panel-border) transparent;
  padding: 0 6px 7px;
  user-select: none;

  /* Set the font-size for input values in the detail panel */
  font-size: 12px;
`

export const contextMenuShownContext = createContext<
  ReturnType<typeof useLockSet>
>([false, () => () => {}])

const DetailPanel: React.FC<{sequenceDockTop?: number}> = ({
  sequenceDockTop,
}) => {
  const t = useT()
  const pin = useVal(getStudio().atomP.ahistoric.pinDetails) !== false
  const hidden = useVal(getStudio().ephemeralAtom.pointer.hiddenPanels.details)

  const hotspotActive = useHotspot('right')

  useLayoutEffect(() => {
    isDetailPanelHotspotActiveB.set(hotspotActive)
  }, [hotspotActive])

  // cleanup
  useEffect(() => {
    return () => {
      isDetailPanelHoveredB.set(false)
      isDetailPanelHotspotActiveB.set(false)
    }
  }, [])

  const [isContextMenuShown] = useContext(contextMenuShownContext)

  const showDetailsPanel = pin || hotspotActive || isContextMenuShown

  const [containerElt, setContainerElt] = useState<null | HTMLDivElement>(null)
  usePresenceListenersOnRootElement(containerElt)

  return usePrism(() => {
    if (hidden) return null

    const selection = outlineSelection.getValue()

    const obj = selection.find(isSheetObject)

    if (obj) {
      // 显示名与大纲行同一来源(覆盖名 ?? objectKey),保证两处一致
      const address = obj.address
      const namesByAddress = val(
        getStudio().atomP.historic.projects.stateByProjectId[address.projectId]
          .outlineNamesByObjectAddress,
      )
      const shownName = objectDisplayNameOf(namesByAddress, address)
      return (
        <Container
          data-testid="DetailPanel-Object"
          $pin={showDetailsPanel}
          $dockTop={sequenceDockTop}
          ref={setContainerElt}
          onMouseEnter={() => {
            isDetailPanelHoveredB.set(true)
          }}
          onMouseLeave={() => {
            isDetailPanelHoveredB.set(false)
          }}
        >
          <Header>
            <Heading>{t('detailPanel.propsRoot')}</Heading>
            <Title
              title={`${obj.sheet.address.sheetId}: ${obj.sheet.address.sheetInstanceId} > ${shownName}`}
            >
              <TitleBar_Piece>{obj.sheet.address.sheetId} </TitleBar_Piece>

              <TitleBar_Punctuation>{':'}&nbsp;</TitleBar_Punctuation>
              <TitleBar_Piece>
                {obj.sheet.address.sheetInstanceId}{' '}
              </TitleBar_Piece>

              <TitleBar_Punctuation>&nbsp;&rarr;&nbsp;</TitleBar_Punctuation>
              <TitleBar_Piece>{shownName}</TitleBar_Piece>
            </Title>
          </Header>
          <Body>
            <ObjectDetails objects={[obj]} />
          </Body>
        </Container>
      )
    }
    // 无选中物体时不显示面板(项目行选中也不再弹 ProjectDetails 空面板,
    // 2026-10-16 用户定夺:整块去掉,Export to JSON 入口随之移除)
    return null
  }, [showDetailsPanel, hidden, sequenceDockTop, t])
}

export default function DetailPanelWithContext(props: {
  sequenceDockTop?: number
}) {
  const lockSet = useLockSet()

  return (
    <contextMenuShownContext.Provider value={lockSet}>
      <DetailPanel {...props} />
    </contextMenuShownContext.Provider>
  )
}

const isDetailPanelHotspotActiveB = new Atom<boolean>(false)
const isDetailPanelHoveredB = new Atom<boolean>(false)

export const shouldShowDetailD = prism<boolean>(() => {
  const isHovered = val(isDetailPanelHoveredB.prism)
  const isHotspotActive = val(isDetailPanelHotspotActiveB.prism)

  return isHovered || isHotspotActive
})
