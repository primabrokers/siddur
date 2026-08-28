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

/**
 * Service worker (11 §6) — production only.
 *
 * Registering in dev would put a cache between the developer and Vite's HMR,
 * and would silently hold the e2e fixture runs to a stale bundle. In
 * production it precaches the shell so the app boots offline; the strategies
 * live in `public/sw.js`.
 *
 * The registration is deferred to `load` so it never competes with the first
 * paint, and every failure is swallowed: a browser that refuses the worker
 * (private mode, an unsupported engine) should get a perfectly ordinary online
 * app, not an error.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  })
}
