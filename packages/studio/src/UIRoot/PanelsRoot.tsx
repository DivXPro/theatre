import OutlinePanel from '@dreamerbird/studio/panels/OutlinePanel/OutlinePanel'
import DetailPanel from '@dreamerbird/studio/panels/DetailPanel/DetailPanel'
import React, {useState} from 'react'
import getStudio from '@dreamerbird/studio/getStudio'
import {useVal} from '@dreamerbird/react'
import ExtensionPaneWrapper from '@dreamerbird/studio/panels/BasePanel/ExtensionPaneWrapper'
import SequenceEditorPanel from '@dreamerbird/studio/panels/SequenceEditorPanel/SequenceEditorPanel'

const PanelsRoot: React.FC = () => {
  const [sequenceDockTop, setSequenceDockTop] = useState<number>()
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
      <DetailPanel sequenceDockTop={sequenceDockTop} />
      <SequenceEditorPanel onDockTopChange={setSequenceDockTop} />
    </>
  )
}

export default PanelsRoot
