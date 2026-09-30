import getStudio from '@dreamerbird/studio/getStudio'
import {decodePathToProp} from '@dreamerbird/utils/pathToProp'
import getDeep from '@dreamerbird/utils/getDeep'
import type {SequenceTrackId} from '@dreamerbird/core/types/public'
import {usePrism} from '@dreamerbird/react'
import type {Pointer} from '@dreamerbird/dataverse'
import {val} from '@dreamerbird/dataverse'
import React from 'react'
import styled from 'styled-components'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {contentWidth} from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/Right/Right'
import HorizontallyScrollableArea from '@dreamerbird/studio/panels/SequenceEditorPanel/DopeSheet/Right/HorizontallyScrollableArea'
import PrimitivePropGraph from './PrimitivePropGraph'
import FrameGrid from '@dreamerbird/studio/panels/SequenceEditorPanel/FrameGrid/FrameGrid'
import {transparentize} from 'polished'

const Container = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  background: ${transparentize(0.03, '#1a1c1e')};
`

const SVGContainer = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  pointer-events: none;
`

const GraphEditor: React.FC<{
  layoutP: Pointer<SequenceEditorPanelLayout>
}> = ({layoutP}) => {
  return usePrism(() => {
    const sheet = val(layoutP.sheet)

    const selectedPropsByObject = val(
      getStudio()!.atomP.historic.projects.stateByProjectId[
        sheet.address.projectId
      ].stateBySheetId[sheet.address.sheetId].sequenceEditor
        .selectedPropsByObject,
    )

    const height = val(layoutP.graphEditorDims.height)

    const unitSpaceToScaledSpaceMultiplier = val(
      layoutP.scaledSpace.fromUnitSpace,
    )(1)

    const graphs: Array<React.ReactElement> = []

    if (selectedPropsByObject) {
      for (const [objectKey, props] of Object.entries(selectedPropsByObject)) {
        const sheetObject = sheet.getObject(objectKey)
        if (!sheetObject) continue
        const validSequenceTracks = val(
          sheetObject.template.getMapOfValidSequenceTracks_forStudio(),
        )
        for (const [encodedPathToProp, graphEditorColor] of Object.entries(
          props!,
        )) {
          const pathToProp = decodePathToProp(encodedPathToProp)
          const possibleSequenceTrackId = getDeep(
            validSequenceTracks,
            pathToProp,
          ) as undefined | SequenceTrackId
          if (!possibleSequenceTrackId) continue

          graphs.push(
            <PrimitivePropGraph
              key={`graph-${objectKey}-${encodedPathToProp}`}
              sheetObject={sheetObject}
              pathToProp={pathToProp}
              layoutP={layoutP}
              trackId={possibleSequenceTrackId}
              color={graphEditorColor!}
            />,
          )
        }
      }
    }

    const width = val(layoutP.rightDims.width)
    return (
      <Container
        style={{
          width: width + 'px',
          height: height + 'px',
          '--unitSpaceToScaledSpaceMultiplier':
            unitSpaceToScaledSpaceMultiplier,
          '--graphEditorVerticalSpace': `${val(
            layoutP.graphEditorVerticalSpace.space,
          )}`,
        }}
      >
        <FrameGrid layoutP={layoutP} width={width} height={height} />
        <HorizontallyScrollableArea layoutP={layoutP} height={height}>
          <SVGContainer
            width={contentWidth}
            height={height}
            viewBox={`0 0 ${contentWidth} ${height}`}
          >
            <g
              style={{
                transform: `translate(${val(
                  layoutP.scaledSpace.leftPadding,
                )}px, ${val(layoutP.graphEditorDims.padding.top)}px)`,
              }}
            >
              {graphs}
            </g>
          </SVGContainer>
        </HorizontallyScrollableArea>
      </Container>
    )
  }, [layoutP])
}

export default GraphEditor
