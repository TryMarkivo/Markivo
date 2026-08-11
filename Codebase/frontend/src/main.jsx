import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { consumeHandoff } from './lib/subdomains'

// Every path renders this same bundle — the app picks its view from state, never
// from the URL — so a stray path (typo, stale deep link) would linger in the address
// bar implying a destination it does not select. Normalise it to `/` before React
// mounts, preserving ?query (onboarding path, auth mode, OAuth return params) and
// #fragment (cross-subdomain session hand-off). The static pages — /terms, /privacy,
// /data-deletion — are standalone HTML that never loads this bundle, so they keep
// their own URLs. Runs first so the hand-off scrub below carries the clean path.
if (window.location.pathname !== '/') {
  window.history.replaceState(null, '', '/' + window.location.search + window.location.hash)
}

// Import a session handed off from another subdomain (via the URL fragment)
// into this origin's localStorage before the app reads its auth tokens.
consumeHandoff()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
