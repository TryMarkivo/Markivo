import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow `*.localhost` (and any host listed in VITE_DEV_ALLOWED_HOSTS) so the
// subdomain router can be exercised locally — e.g. http://login.localhost:5173.
const extraHosts = (process.env.VITE_DEV_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['.localhost', ...extraHosts],
  },
})
