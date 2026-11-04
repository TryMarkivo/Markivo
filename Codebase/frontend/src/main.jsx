import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Icons are bundled with the app, not loaded from a CDN.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/regular.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import '@fortawesome/fontawesome-free/css/brands.min.css'
import './index.css'
import './styles/ui.css'
import App from './App.jsx'
import { consumeHandoff } from './lib/subdomains'
import { DEMO, installDemo } from './lib/demo'

// Import a session handed off from another subdomain (via the URL fragment)
// into this origin's localStorage before the app reads its auth tokens.
consumeHandoff()

// Preview builds only (VITE_DEMO=1): sample data, no backend, no sign-in.
if (DEMO) installDemo()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
