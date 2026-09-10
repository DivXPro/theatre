import React from 'react'
import ReactDOM from 'react-dom/client'
import theatre from '@dreamerbird/core'
import {getProject} from '@dreamerbird/core'
import '@dreamerbird/studio'
import ThreeScene from './ThreeScene'

void theatre.init({studio: true})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThreeScene project={getProject('Three Basic')} />,
)
