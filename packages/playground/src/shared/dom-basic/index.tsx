import React from 'react'
import ReactDOM from 'react-dom/client'
import theatre from '@toy-box/core'
import {getProject} from '@toy-box/core'
import '@toy-box/studio'
import {Scene} from './Scene'
/**
 * This is a basic example of using Theatre.js for manipulating the DOM.
 */

void theatre.init({studio: true})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Scene project={getProject('Sample project')} />,
)
