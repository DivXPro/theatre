import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@toy-box/core'
import '@toy-box/studio'
import extension from '@toy-box/r3f/dist/extension'

void theatre.init({studio: true})
void theatre.getStudio().then((studio) => studio.extend(extension))

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
