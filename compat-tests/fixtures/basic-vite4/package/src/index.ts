import {getProject} from '@toy-box/core'

const project = getProject('Sample project')
const sheet = project.sheet('Scene')

if (import.meta.env.MODE === 'development') {
  const {default: studio} = await import('@toy-box/studio')
  studio.initialize()
}
