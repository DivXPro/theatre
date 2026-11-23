import type {SequenceEditorTree_SheetObject} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/tree'
import React from 'react'
import styled from 'styled-components'
import AnyCompositeRow, {
  BaseHeader,
  LeftRowContainer,
  sequenceRowPaddingLeft,
  SequenceRowLeadingSpacer,
} from './AnyCompositeRow'
import {decideRowByPropType} from './PropWithChildrenRow'
import {setCollapsedSheetItem} from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/setCollapsedSheetObjectOrCompoundProp'
import getStudio from '@dreamerbird/studio/getStudio'

const AdditionalRowBody = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 100%;
`

const LeftSheetObjectRow: React.FC<{
  leaf: SequenceEditorTree_SheetObject
}> = ({leaf}) => {
  const headerActions = leaf.additionalRows.flatMap(({content}) => {
    const action = content.renderObjectHeader?.()
    return action
      ? [
          <React.Fragment key={`object-action:${content.id}`}>
            {action}
          </React.Fragment>,
        ]
      : []
  })
  return (
    <AnyCompositeRow
      leaf={leaf}
      label={leaf.sheetObject.address.objectKey}
      isCollapsed={leaf.isCollapsed}
      headerActions={headerActions.length ? headerActions : undefined}
      toggleSelect={() => {
        // set selection to this sheet object on click
        getStudio().transaction(({stateEditors}) => {
          stateEditors.studio.historic.panels.outline.selection.set([
            {type: 'SheetObject', ...leaf.sheetObject.address},
          ])
        })
      }}
      toggleCollapsed={() =>
        setCollapsedSheetItem(!leaf.isCollapsed, {
          sheetAddress: leaf.sheetObject.address,
          sheetItemKey: leaf.sheetItemKey,
        })
      }
    >
      {[
        ...leaf.children.map((leaf) => decideRowByPropType(leaf)),
        ...leaf.additionalRows
          .filter((row) => row.shouldRender)
          .map((additional) => (
            <LeftRowContainer
              key={`additional:${additional.content.id}`}
              $depth={additional.depth}
            >
              <BaseHeader
                $isEven={additional.n % 2 === 0}
                style={{
                  height: additional.nodeHeight,
                  paddingLeft: sequenceRowPaddingLeft(additional.depth),
                  paddingRight: 6,
                }}
              >
                <SequenceRowLeadingSpacer />
                <AdditionalRowBody>
                  {additional.content.renderHeader()}
                </AdditionalRowBody>
              </BaseHeader>
            </LeftRowContainer>
          )),
      ]}
    </AnyCompositeRow>
  )
}

export default LeftSheetObjectRow
