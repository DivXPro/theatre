import ReactDOM from 'react-dom/client'
import theatre from '@dreamerbird/core'
// 1.0 API: side-effect import registers the studio bundle
import '@dreamerbird/studio'
import extension from '@dreamerbird/r3f/dist/extension'
import App from './App/App'

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
root.render(<App />)
