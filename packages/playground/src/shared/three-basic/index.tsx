import React from 'react'
import ReactDOM from 'react-dom/client'
import theatre from '@toy-box/core'
import {getProject} from '@toy-box/core'
import ThreeScene from './ThreeScene'

void theatre.init({studio: true})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThreeScene project={getProject('Three Basic')} />,
)
