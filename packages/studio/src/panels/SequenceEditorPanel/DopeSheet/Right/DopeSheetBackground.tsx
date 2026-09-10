import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {zIndexes} from '@dreamerbird/studio/panels/SequenceEditorPanel/SequenceEditorPanel'
import {useVal} from '@dreamerbird/react'
import type {Pointer} from '@dreamerbird/dataverse'
import {darken, transparentize} from 'polished'
import React from 'react'
import styled from 'styled-components'
import FrameGrid from '@dreamerbird/studio/panels/SequenceEditorPanel/FrameGrid/FrameGrid'

const Container = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: ${() => zIndexes.rightBackground};
  overflow: hidden;
  /* 派生色:polished 无法处理 var(),一期保持静态计算值(原 theme.panel.bg = #282b2f) */
  background: ${transparentize(0.01, darken(1 * 0.03, '#282b2f'))};
  pointer-events: none;
`

const DopeSheetBackground: React.FC<{
  layoutP: Pointer<SequenceEditorPanelLayout>
}> = ({layoutP}) => {
  const width = useVal(layoutP.rightDims.width)
  const height = useVal(layoutP.panelDims.height)

  return (
    <Container style={{width: width + 'px'}}>
      <FrameGrid width={width} height={height} layoutP={layoutP} />
    </Container>
  )
}

export default DopeSheetBackground
