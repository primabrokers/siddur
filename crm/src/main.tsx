import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// TODO(pwa): register a service worker once the offline capture queue exists
// (11 §6). The manifest already ships; there is deliberately no SW yet.
