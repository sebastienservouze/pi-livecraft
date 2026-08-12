export const HERMES_FILES_PATH = '/files'
export const HERMES_CHAT_PATH = '/chat'

type HermesGlobals = {
  __HERMES_PLUGIN_SDK__?: unknown
  __HERMES_PLUGINS__?: unknown
}

/** True when the Pi Coding UI tab is running inside the Hermes dashboard shell. */
export function isHermesDashboardHost(
  globals: HermesGlobals = globalThis as typeof globalThis & HermesGlobals,
): boolean {
  return Boolean(globals.__HERMES_PLUGIN_SDK__ || globals.__HERMES_PLUGINS__)
}

/**
 * Navigates to a Hermes dashboard route in the same browser origin.
 * Used instead of OS desktop launchers when the plugin is hosted by Hermes.
 */
export function openHermesDashboardRoute(
  path: string,
  assign: (url: string) => void = (url) => {
    const location =
      (globalThis as typeof globalThis & { location?: { assign: (href: string) => void } })
        .location
    location?.assign(url)
  },
): void {
  const normalized = path.startsWith('/') ? path : `/${path}`
  assign(normalized)
}

/** Opens Hermes Files (in-browser explorer) or falls back to the OS launcher callback. */
export function openFolderAction(
  openOsExplorer: () => Promise<void>,
  options: {
    isHermes?: boolean
    openRoute?: (path: string) => void
  } = {},
): Promise<void> {
  const hermes = options.isHermes ?? isHermesDashboardHost()
  if (hermes) {
    ;(options.openRoute ?? openHermesDashboardRoute)(HERMES_FILES_PATH)
    return Promise.resolve()
  }
  return openOsExplorer()
}

/** Opens Hermes Chat (in-browser terminal) or falls back to the OS launcher callback. */
export function openTerminalAction(
  openOsTerminal: () => Promise<void>,
  options: {
    isHermes?: boolean
    openRoute?: (path: string) => void
  } = {},
): Promise<void> {
  const hermes = options.isHermes ?? isHermesDashboardHost()
  if (hermes) {
    ;(options.openRoute ?? openHermesDashboardRoute)(HERMES_CHAT_PATH)
    return Promise.resolve()
  }
  return openOsTerminal()
}
