import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from '@dreamerbird/studio/getStudio'
import React from 'react'
import BaseItem from '@dreamerbird/studio/panels/OutlinePanel/BaseItem'
import {useVal} from '@dreamerbird/react'
import {outlineSelection} from '@dreamerbird/studio/selectors'
import {useOutlineObjectMenu} from '@dreamerbird/studio/panels/OutlinePanel/outlineOps/useOutlineObjectMenu'

export const ObjectItem: React.FC<{
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

  const {targetRef, displayName, editingMode, submitEditing, cancelEditing} =
    useOutlineObjectMenu(sheetObject)

  return (
    <BaseItem
      select={select}
      label={displayName ?? overrideLabel ?? sheetObject.address.objectKey}
      depth={depth}
      headerRef={targetRef}
      selectionStatus={
        selection.includes(sheetObject) ? 'selected' : 'not-selected'
      }
      rename={{
        editing: editingMode !== null,
        onSubmit: submitEditing,
        onCancel: cancelEditing,
      }}
    />
  )
}
