import React from 'react'
import PanelResizeHandle from './PanelResizeHandle'
import {usePanel} from './BasePanel'

const PanelResizers: React.FC<{}> = (props) => {
  // 停靠底边的面板(时间轴)只留顶边手柄调高度,其余边/角拖拽没意义
  if (usePanel().docked === 'bottom') {
    return <PanelResizeHandle which="Top" />
  }
  return (
    <>
      <PanelResizeHandle which="Bottom" />
      <PanelResizeHandle which="Top" />
      <PanelResizeHandle which="Left" />
      <PanelResizeHandle which="Right" />
      <PanelResizeHandle which="TopLeft" />
      <PanelResizeHandle which="TopRight" />
      <PanelResizeHandle which="BottomLeft" />
      <PanelResizeHandle which="BottomRight" />
    </>
  )
}

export default PanelResizers
