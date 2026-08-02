import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.PI_LIVECRAFT_BACKEND_PORT ?? '31021'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
})
