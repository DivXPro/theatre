import type SheetObject from '@toy-box/core/sheetObjects/SheetObject'
import getStudio from '@toy-box/studio/getStudio'
import React from 'react'
import BaseItem from '@toy-box/studio/panels/OutlinePanel/BaseItem'
import {useVal} from '@toy-box/react'
import {outlineSelection} from '@toy-box/studio/selectors'
import useChordial from '@toy-box/studio/uiComponents/chordial/useChodrial'

export const ObjectItem: React.VFC<{
  sheetObject: SheetObject
  depth: number
  overrideLabel?: string
}> = ({sheetObject, depth, overrideLabel}) => {
  const select = () => {
    getStudio()!.transaction(({stateEditors}) => {
      stateEditors.studio.historic.panels.outline.selection.set([
        {...sheetObject.address, type: 'SheetObject'},
      ])
    })
  }

  const selection = useVal(outlineSelection)

  const {targetRef} = useChordial(() => {
    return {
      title: `Object: ${sheetObject.address.objectKey}`,
      items: [],
    }
  })

  return (
    <BaseItem
      select={select}
      label={overrideLabel ?? sheetObject.address.objectKey}
      depth={depth}
      headerRef={targetRef}
      selectionStatus={
        selection.includes(sheetObject) ? 'selected' : 'not-selected'
      }
    />
  )
}
