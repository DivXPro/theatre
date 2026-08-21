import OutlinePanel from '@toy-box/studio/panels/OutlinePanel/OutlinePanel'
import DetailPanel from '@toy-box/studio/panels/DetailPanel/DetailPanel'
import React from 'react'
import getStudio from '@toy-box/studio/getStudio'
import {useVal} from '@toy-box/react'
import ExtensionPaneWrapper from '@toy-box/studio/panels/BasePanel/ExtensionPaneWrapper'
import SequenceEditorPanel from '@toy-box/studio/panels/SequenceEditorPanel/SequenceEditorPanel'

const PanelsRoot: React.FC = () => {
  const panes = useVal(getStudio().paneManager.allPanesD)
  const paneEls = Object.entries(panes).map(([instanceId, paneInstance]) => {
    return (
      <ExtensionPaneWrapper
        key={`pane-${instanceId}`}
        paneInstance={paneInstance!}
      />
    )
  })

  return (
    <>
      {paneEls}
      <OutlinePanel />
      <DetailPanel />
      <SequenceEditorPanel />
    </>
  )
}

export default PanelsRoot
