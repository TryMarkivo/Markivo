import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { consumeHandoff } from './lib/subdomains'

// Import a session handed off from another subdomain (via the URL fragment)
// into this origin's localStorage before the app reads its auth tokens.
consumeHandoff()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
