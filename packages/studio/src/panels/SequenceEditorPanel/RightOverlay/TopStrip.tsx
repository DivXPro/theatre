import {useVal} from '@dreamerbird/react'
import type {Pointer} from '@dreamerbird/dataverse'
import React from 'react'
import styled from 'styled-components'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import StampsGrid from '@dreamerbird/studio/panels/SequenceEditorPanel/FrameGrid/StampsGrid'
import {includeLockFrameStampAttrs} from '@dreamerbird/studio/panels/SequenceEditorPanel/FrameStampPositionProvider'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import FocusRangeZone from './FocusRangeZone/FocusRangeZone'

export const topStripHeight = 18

export const topStripTheme = {
  backgroundColor: `#1f2120eb`,
  borderColor: `#1c1e21`,
}

const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: ${topStripHeight}px;
  box-sizing: border-box;
  background: ${topStripTheme.backgroundColor};
  border-bottom: 1px solid ${topStripTheme.borderColor};
  ${pointerEventsAutoInNormalMode};
`

const TopStrip: React.FC<{layoutP: Pointer<SequenceEditorPanelLayout>}> = ({
  layoutP,
}) => {
  const width = useVal(layoutP.rightDims.width)

  return (
    <>
      <Container {...includeLockFrameStampAttrs('hide')}>
        <StampsGrid layoutP={layoutP} width={width} height={topStripHeight} />
        <FocusRangeZone layoutP={layoutP} />
      </Container>
    </>
  )
}

export default TopStrip
