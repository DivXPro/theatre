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
const {isSheetObject} = __private.instanceTypes

const headerHeight = `32px`

const Container = styled.div<{$pin: boolean}>`
  ${pointerEventsAutoInNormalMode};
  background-color: var(--theatre-panel-bg-80);
  position: fixed;
  right: 8px;
  top: 50px;
  // Temporary, see comment about CSS grid in SingleRowPropEditor.
  width: 280px;
  height: fit-content;
  z-index: ${panelZIndexes.propsPanel};

  box-shadow:
    0 1px 1px var(--theatre-shadow-color),
    0 2px 6px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(14px);
  border-radius: 2px;

  display: ${({$pin}) => ($pin ? 'block' : 'none')};

  &:hover {
    display: block;
  }

  @supports not (backdrop-filter: blur()) {
    background: var(--theatre-panel-bg-95);
  }
`

const Title = styled.div`
  margin: 0 10px;
  color: #919191;
  font-weight: 500;
  font-size: 10px;
  user-select: none;
  ${pointerEventsAutoInNormalMode};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Header = styled.div`
  height: ${headerHeight};
  display: flex;
  align-items: center;
`

const Body = styled.div`
  ${pointerEventsAutoInNormalMode};
  max-height: calc(100vh - 100px);
  overflow-y: scroll;
  &::-webkit-scrollbar {
    display: none;
  }

  scrollbar-width: none;
  padding: 0;
  user-select: none;

  /* Set the font-size for input values in the detail panel */
  font-size: 12px;
`

export const contextMenuShownContext = createContext<
  ReturnType<typeof useLockSet>
>([false, () => () => {}])

const DetailPanel: React.FC<{}> = (props) => {
  const pin = useVal(getStudio().atomP.ahistoric.pinDetails) !== false

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
          ref={setContainerElt}
          onMouseEnter={() => {
            isDetailPanelHoveredB.set(true)
          }}
          onMouseLeave={() => {
            isDetailPanelHoveredB.set(false)
          }}
        >
          <Header>
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
  }, [showDetailsPanel])
}

export default () => {
  const lockSet = useLockSet()

  return (
    <contextMenuShownContext.Provider value={lockSet}>
      <DetailPanel />
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
