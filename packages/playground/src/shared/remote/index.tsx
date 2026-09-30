import React from 'react'
import ReactDOM from 'react-dom/client'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import {getProject} from '@dreamerbird/core'
import {Scene} from './Scene'
import RemoteController from './RemoteController'

const project = getProject('Sample project')
void theatre.init({studio: true})
// RemoteController touches the studio (ui.hide/restore, selection) — wait
// until the studio has attached
void theatre.getStudio().then(() => RemoteController(project))

ReactDOM.createRoot(document.getElementById('root')!).render(<Scene />)
