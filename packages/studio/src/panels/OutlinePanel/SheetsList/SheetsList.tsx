import {getRegisteredSheetIds} from '@toy-box/studio/selectors'
import {usePrism} from '@toy-box/react'
import React from 'react'
import {SheetItem} from './SheetItem'
import type Project from '@toy-box/core/projects/Project'

const SheetsList: React.FC<{
  project: Project
  depth: number
}> = ({project, depth}) => {
  return usePrism(() => {
    if (!project) return null

    const registeredSheetIds = getRegisteredSheetIds(project)

    return (
      <>
        {registeredSheetIds.map((sheetId) => {
          return (
            <SheetItem
              depth={depth}
              sheetId={sheetId}
              key={`sheet-${sheetId}`}
              project={project}
            ></SheetItem>
          )
        })}
      </>
    )
  }, [project, depth])
}

export default SheetsList
