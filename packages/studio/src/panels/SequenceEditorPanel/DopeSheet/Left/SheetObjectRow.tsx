import type {SequenceEditorTree_SheetObject} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/tree'
import React from 'react'
import AnyCompositeRow, {BaseHeader, LeftRowContainer} from './AnyCompositeRow'
import {decideRowByPropType} from './PropWithChildrenRow'
import {setCollapsedSheetItem} from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/setCollapsedSheetObjectOrCompoundProp'
import getStudio from '@dreamerbird/studio/getStudio'

const LeftSheetObjectRow: React.FC<{
  leaf: SequenceEditorTree_SheetObject
}> = ({leaf}) => {
  const additional = leaf.additionalRow
  return (
    <AnyCompositeRow
      leaf={leaf}
      label={leaf.sheetObject.address.objectKey}
      isCollapsed={leaf.isCollapsed}
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
        additional?.shouldRender && (
          <LeftRowContainer
            key={additional.content.id}
            $depth={additional.depth}
          >
            <BaseHeader
              $isEven={additional.n % 2 === 0}
              style={{
                height: additional.nodeHeight,
                paddingLeft: additional.depth * 20,
              }}
            >
              {additional.content.renderHeader()}
            </BaseHeader>
          </LeftRowContainer>
        ),
      ]}
    </AnyCompositeRow>
  )
}

export default LeftSheetObjectRow
