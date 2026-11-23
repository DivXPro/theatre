import React from 'react'
import type {ISheetObject} from '@dreamerbird/core'
import {privateAPI} from '@dreamerbird/core/privateAPIs'
import type {Pointer} from '@dreamerbird/dataverse'
import {usePrism, useVal} from '@dreamerbird/react'
import type {SequenceEditorPanelLayout} from '@dreamerbird/studio/panels/SequenceEditorPanel/layout/layout'
import {getScenePoseCoverageSpans} from './poseFrame'
import {getPoseKeyframePositions} from './poseTrack'

export function ScenePoseCoverageTrack({
  object,
  layout,
}: {
  object: ISheetObject<any>
  layout: Pointer<SequenceEditorPanelLayout>
}): React.ReactElement | null {
  const leftPadding = useVal(layout.scaledSpace.leftPadding)
  const spans = usePrism(
    () =>
      getScenePoseCoverageSpans(
        getPoseKeyframePositions(object),
        privateAPI(object.sheet.sequence).length,
      ),
    [object],
  )
  if (spans.length === 0) return null
  return (
    <div
      aria-hidden="true"
      style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}
    >
      {spans.map(({start, end, held}) => (
        <div
          key={start}
          style={{
            position: 'absolute',
            bottom: 3,
            left: `calc(${leftPadding}px + var(--unitSpaceToScaledSpaceMultiplier) * ${start}px)`,
            width: `calc(var(--unitSpaceToScaledSpaceMultiplier) * ${
              end - start
            }px)`,
            borderTop: `1px ${held ? 'dashed' : 'solid'} currentColor`,
            opacity: held ? 0.5 : 0.85,
          }}
        />
      ))}
    </div>
  )
}
