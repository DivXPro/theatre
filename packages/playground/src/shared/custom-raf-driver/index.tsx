import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@toy-box/core'
import extension from '@toy-box/r3f/dist/extension'
import {createRafDriver} from '@toy-box/core'

const rafDriver = createRafDriver({name: 'a custom 5fps raf driver'})
setInterval(() => {
  rafDriver.tick(performance.now())
}, 200)

void theatre.getStudio().then((studio) => studio.extend(extension))
void theatre.init({studio: true, rafDriver})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App rafDriver={rafDriver} />,
)
