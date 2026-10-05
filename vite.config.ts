import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'

// Base path is taken from the environment at build time: the frontend can
// be served at / (standalone) or under a path prefix behind a reverse
// proxy. Unset keeps the stock root behavior. The API base is the same
// path without its trailing slash ('' at the root base.
const basePath = process.env.PI_LIVECRAFT_BASE_PATH ?? '/'
const apiBase = basePath.replace(/\/+$/, '')

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  define: {
    'globalThis.__API_BASE__': JSON.stringify(apiBase),
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
})
