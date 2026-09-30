import type Sheet from '@dreamerbird/core/sheets/Sheet'
import React from 'react'
import ObjectsList from '@dreamerbird/studio/panels/OutlinePanel/ObjectsList/ObjectsList'

export const SheetInstanceItem: React.FC<{
  depth: number
  sheet: Sheet
}> = ({sheet, depth}) => {
  // 不渲染 sheet 行(如 "Space: default"),物体节点直接顶替它的缩进层级,
  // 大纲树只显示当前场景中的物体
  return (
    <ObjectsList
      depth={depth}
      sheet={sheet}
      key={'objectList' + sheet.address.sheetInstanceId}
    />
  )
}
