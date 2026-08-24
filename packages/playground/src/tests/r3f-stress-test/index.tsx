import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import theatre from '@toy-box/core'
import '@toy-box/studio'
import extension from '@toy-box/r3f/dist/extension'
import getStudio from '@toy-box/studio/getStudio'

void theatre
  .init({studio: true})
  .then(() => theatre.getStudio())
  .then((studio) => studio.extend(extension))

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

// Show "ticks per second" information in performance measurements using the User Timing API
// See https://developer.mozilla.org/en-US/docs/Web/API/User_Timing_API
// See https://web.dev/user-timings/
void theatre.getStudio().then(() => {
  const raf = getStudio().ticker
  setInterval(() => {
    const start = {
      ticks: raf.__ticks,
      now: Date.now(),
    }
    const id = start.now.toString(36) + 'fps'
    performance.mark(id)
    setTimeout(() => {
      const ticksPerSec =
        ((raf.__ticks - start.ticks) * 1000) / (Date.now() - start.now)
      // This shows up in the performance tab of devtools if you record!
      performance.measure(
        `${ticksPerSec.toFixed(0)}t/1s - ${(ticksPerSec * 0.5).toFixed(
          0,
        )}t/500ms`,
        id,
      )
    }, 2000)
  }, 500)
})
