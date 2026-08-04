import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'
const frontendPort = Number(process.env.PI_LIVECRAFT_FRONTEND_PORT ?? '43122')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
})
