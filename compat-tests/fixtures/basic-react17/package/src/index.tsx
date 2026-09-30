import React from 'react'
import ReactDOM from 'react-dom'
import studio from '@dreamerbird/studio'
import {getProject} from '@dreamerbird/core'
import {Scene} from './App/Scene'

studio.initialize()

ReactDOM.render(
  <Scene project={getProject('Sample project')} />,
  document.getElementById('root')!,
)
