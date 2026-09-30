import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@dreamerbird/core'
import '@dreamerbird/studio'
import extension from '@dreamerbird/r3f/dist/extension'

// connect directly to a local sync-server (yarn cli dev start in
// packages/sync-server) — no app needed in the self-hosted minimal loop
void theatre.init({studio: true, serverUrl: 'ws://localhost:3000'})
void theatre.getStudio().then((studio) => studio.extend(extension))

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
