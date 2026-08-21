/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-restricted-syntax */
import '@toy-box/studio'
import type {SheetId} from '@toy-box/core'
import {getProject} from '@toy-box/core'
import {privateAPI} from '@toy-box/core/privateAPIs'
import type {ProjectState_Historic} from '@toy-box/core/types/private/core'
import type {SheetState_Historic} from '@toy-box/core/types/private/core'
import * as t from '@toy-box/core/propTypes'
import getStudio from '@toy-box/studio/getStudio'
import {getCoreTicker} from '@toy-box/core/coreTicker'
import {globals} from '@toy-box/core/globals'
import theatre from '@toy-box/core'

const defaultProps = {
  position: {
    x: 0,
    y: 0,
    z: 0,
  },
  color: t.rgba(),
  deeply: {
    nested: {
      checkbox: true,
    },
  },
}

let lastProjectN = 0

const studio = getStudio()!
void theatre.init({studio: true, usePersistentStorage: false})

export async function setupTestSheet(sheetState: SheetState_Historic) {
  const projectState: ProjectState_Historic = {
    definitionVersion: globals.currentProjectStateDefinitionVersion,
    sheetsById: {
      ['Sheet' as SheetId]: sheetState,
    },
    revisionHistory: [],
  }
  const project = getProject('Test Project ' + lastProjectN++, {
    state: projectState,
  })

  const ticker = getCoreTicker()

  ticker.tick()
  await project.ready
  const sheetPublicAPI = project.sheet('Sheet')
  const objPublicAPI = sheetPublicAPI.object('obj', defaultProps)

  const obj = privateAPI(objPublicAPI)

  return {
    obj,
    objPublicAPI,
    sheet: privateAPI(sheetPublicAPI),
    project,
    ticker,
    studio,
  }
}
