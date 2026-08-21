import getStudio from '@toy-box/studio/getStudio'
import {outlineSelection} from '@toy-box/studio/selectors'
import {useVal} from '@toy-box/react'
import React, {useCallback} from 'react'
import styled from 'styled-components'
import ObjectsList from '@toy-box/studio/panels/OutlinePanel/ObjectsList/ObjectsList'
import BaseItem from '@toy-box/studio/panels/OutlinePanel/BaseItem'
import type Sheet from '@toy-box/core/sheets/Sheet'
import {useCollapseStateInOutlinePanel} from '@toy-box/studio/panels/OutlinePanel/outlinePanelUtils'
import useChordial from '@toy-box/studio/uiComponents/chordial/useChodrial'

const Head = styled.div`
  display: flex;
`

const Body = styled.div``

export const SheetInstanceItem: React.FC<{
  depth: number
  sheet: Sheet
}> = ({sheet, depth}) => {
  const {collapsed, setCollapsed} = useCollapseStateInOutlinePanel(sheet)

  const setSelectedSheet = useCallback(() => {
    getStudio()!.transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...sheet.address, type: 'Sheet'},
      ])
    })
  }, [sheet])

  const selection = useVal(outlineSelection)

  const {targetRef} = useChordial(() => {
    return {
      title: `Sheet: ${sheet.address.sheetId} (instance: ${sheet.address.sheetInstanceId})`,
      items: [],
    }
  })

  return (
    <BaseItem
      depth={depth}
      select={setSelectedSheet}
      setIsCollapsed={setCollapsed}
      collapsed={collapsed}
      headerRef={targetRef}
      selectionStatus={
        selection.some((s) => s === sheet)
          ? 'selected'
          : selection.some(
                (s) => s.type === 'Theatre_SheetObject' && s.sheet === sheet,
              )
            ? 'descendant-is-selected'
            : 'not-selected'
      }
      label={
        <Head>
          {sheet.address.sheetId}: {sheet.address.sheetInstanceId}
        </Head>
      }
    >
      <Body>
        <ObjectsList
          depth={depth + 1}
          sheet={sheet}
          key={'objectList' + sheet.address.sheetInstanceId}
        />
      </Body>
    </BaseItem>
  )
}
