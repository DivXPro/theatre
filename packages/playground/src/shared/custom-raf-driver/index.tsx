import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import extension from '@dreamerbird/r3f/dist/extension'
import {createRafDriver} from '@dreamerbird/core'

const rafDriver = createRafDriver({name: 'a custom 5fps raf driver'})
setInterval(() => {
  rafDriver.tick(performance.now())
}, 200)

void theatre.init({studio: true, rafDriver})
void theatre.getStudio().then((studio) => studio.extend(extension))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App rafDriver={rafDriver} />,
)
