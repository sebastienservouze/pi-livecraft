export const PLUGIN_NAME = 'pi-livecraft'

export interface HermesPluginRegistry {
  register: (name: string, component: unknown) => void
}

/** Registers the Pi Livecraft page with the Hermes dashboard plugin host. */
export function registerPiLivecraftPlugin(
  Component: unknown,
  registry: HermesPluginRegistry | undefined,
  logError: (message: string) => void = console.error,
): void {
  if (registry) registry.register(PLUGIN_NAME, Component)
  else logError(`${PLUGIN_NAME}: window.__HERMES_PLUGINS__ not found`)
}
