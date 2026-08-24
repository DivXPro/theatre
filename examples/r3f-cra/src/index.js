import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import theatre from '@toy-box/core'
// 1.0 API: side-effect import registers the studio bundle
import '@toy-box/studio'
import extension from '@toy-box/r3f/dist/extension'
import React from 'react'
import App from './App'

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // 1.0 API: init() must be called before getStudio()
  void theatre
    .init({studio: true, usePersistentStorage: false})
    .then(() => theatre.getStudio())
    .then((studio) => {
      studio.extend(extension)
    })
}

const container = document.getElementById('root')
const root = ReactDOM.createRoot(container)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
