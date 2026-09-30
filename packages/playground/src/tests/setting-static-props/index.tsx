import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import {getProject} from '@dreamerbird/core'

void theatre.init({studio: true, usePersistentStorage: false})

const project = getProject('sample project')
const sheet = project.sheet('sample sheet')
const obj = sheet.object('sample object', {
  position: {
    x: 0,
    y: 0,
  },
})
