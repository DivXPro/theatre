import ReactDOM from 'react-dom'
import './index.css'
import reportWebVitals from './reportWebVitals'
import theatre, {getProject} from '@dreamerbird/core'
import '@dreamerbird/studio'
import React from 'react'
import App from './App'

void theatre
  .init({studio: true})
  // render only once the studio has attached, so App can use getStudioSync()
  .then(() => theatre.getStudio())
  .then(() => {
    ReactDOM.render(
      <React.StrictMode>
        <App project={getProject('CRA project')} />
      </React.StrictMode>,
      document.getElementById('root'),
    )
  })

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
