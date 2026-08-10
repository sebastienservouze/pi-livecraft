import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: 'react/jsx-runtime',
        replacement: resolve(projectRoot, 'src/plugin/jsx-runtime-shim.ts'),
      },
      {
        find: 'react/jsx-dev-runtime',
        replacement: resolve(projectRoot, 'src/plugin/jsx-dev-runtime-shim.ts'),
      },
      {
        find: 'react',
        replacement: resolve(projectRoot, 'src/plugin/react-sdk-shim.ts'),
      },
    ],
  },
  build: {
    lib: {
      entry: resolve(projectRoot, 'src/plugin-entry.tsx'),
      formats: ['iife'],
      name: 'HermesPiCodingUiPlugin',
      fileName: () => 'index.js',
    },
    outDir: 'dashboard/dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react'],
      output: {
        extend: true,
        assetFileNames: 'style.css',
        globals: {
          react: 'window.__HERMES_PLUGIN_SDK__.React',
        },
      },
    },
  },
})
