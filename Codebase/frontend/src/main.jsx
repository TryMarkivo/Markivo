import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
