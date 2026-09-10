import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import extension from '@dreamerbird/r3f/dist/extension'

void theatre.init({studio: true})
void theatre.getStudio().then((studio) => studio.extend(extension))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
