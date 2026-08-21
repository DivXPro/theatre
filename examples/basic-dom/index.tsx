import React from 'react'
import ReactDOM from 'react-dom/client'
import theatre, {getProject} from '@toy-box/core'
import '@toy-box/studio'
import {Scene} from './Scene'

void theatre.init({studio: true})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Scene project={getProject('Sample project')} />,
)
