import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = dirname(fileURLToPath(import.meta.url))

// Browser IIFE needs process/require shims: Radix pulls react-dom CJS which
// calls require("react"), and some deps read process.env.NODE_ENV.
const browserCompatBanner =
  `(()=>{var g=typeof globalThis!=="undefined"?globalThis:window;if(typeof g.process==="undefined"){g.process={env:{NODE_ENV:"production"}};}if(typeof g.require==="undefined"){g.require=function(id){if(id==="react"){var sdk=g.__HERMES_PLUGIN_SDK__;if(sdk&&sdk.React)return sdk.React;}throw new Error('Cannot require "'+id+'" in Hermes plugin bundle');};}})();`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
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
        banner: browserCompatBanner,
        assetFileNames: 'style.css',
        globals: {
          react: 'window.__HERMES_PLUGIN_SDK__.React',
        },
      },
    },
  },
})
