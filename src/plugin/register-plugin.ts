export const PLUGIN_NAME = 'hermes-pi-coding-ui-plugin'

export interface HermesPluginRegistry {
  register: (name: string, component: unknown) => void
}

/** Registers the plugin page with the Hermes dashboard host. */
export function registerPiLivecraftPlugin(
  Component: unknown,
  registry: HermesPluginRegistry | undefined,
  logError: (message: string) => void = console.error,
): void {
  if (registry) registry.register(PLUGIN_NAME, Component)
  else logError(`${PLUGIN_NAME}: window.__HERMES_PLUGINS__ not found`)
}
