import App from './App.tsx'
import { registerPiLivecraftPlugin } from './plugin/register-plugin.ts'

declare global {
  interface Window {
    __HERMES_PLUGINS__?: import('./plugin/register-plugin.ts').HermesPluginRegistry
  }
}

registerPiLivecraftPlugin(App, window.__HERMES_PLUGINS__)
