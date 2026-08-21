import React from 'react'
import ReactDOM from 'react-dom'
import studio from '@toy-box/studio'
import {getProject} from '@toy-box/core'
import {Scene} from './App/Scene'

studio.initialize()

ReactDOM.render(
  <Scene project={getProject('Sample project')} />,
  document.getElementById('root')!,
)
