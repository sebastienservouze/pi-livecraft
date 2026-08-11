import { PLUGIN_NAME } from '../../plugin/register-plugin.ts'

const STORAGE_KEY = 'pi-livecraft.backend-url'
export const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:43121'
export const HERMES_PLUGIN_BACKEND_PATH = `/api/plugins/${PLUGIN_NAME}`

type BackendStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function backendStorage(): BackendStorage | undefined {
  return (globalThis as typeof globalThis & { localStorage?: BackendStorage }).localStorage
}

/** Returns the Hermes same-origin plugin mount when the dashboard tab is active. */
export function hermesPluginBackendBaseUrl(): string | null {
  const location = (globalThis as typeof globalThis & { location?: { origin?: string } }).location
  if (!location?.origin) return null
  return `${location.origin}${HERMES_PLUGIN_BACKEND_PATH}`
}

/** Default backend URL: Hermes plugin proxy in the dashboard, loopback when running standalone. */
export function defaultBackendBaseUrl(): string {
  return hermesPluginBackendBaseUrl() ?? DEFAULT_BACKEND_BASE_URL
}

/** Normalizes a backend base URL for fetch and EventSource calls. */
export function normalizeBackendBaseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.search || url.hash) return null
    let path = url.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return `${url.protocol}//${url.host}${path === '/' ? '' : path}`
  } catch {
    return null
  }
}

/** Reads the persisted backend base URL, falling back to the dashboard plugin mount. */
export function readBackendBaseUrl(): string {
  try {
    const stored = backendStorage()?.getItem(STORAGE_KEY)
    if (stored) {
      const normalized = normalizeBackendBaseUrl(stored)
      if (normalized) return normalized
    }
  } catch {
    // Ignore storage failures and use the default.
  }
  return defaultBackendBaseUrl()
}

/** Persists the backend base URL after validation. */
export function persistBackendBaseUrl(value: string): string {
  const normalized = normalizeBackendBaseUrl(value)
  if (!normalized) {
    throw new Error(
      'Enter a valid backend URL such as https://example.com/api/plugins/hermes-pi-coding-ui-plugin',
    )
  }
  backendStorage()?.setItem(STORAGE_KEY, normalized)
  return normalized
}

/** Resolves the backend base URL used by the frontend HTTP boundary. */
export function resolveBackendBaseUrl(): string {
  return readBackendBaseUrl()
}

/** Clears a custom backend URL and restores the default Hermes plugin mount. */
export function resetBackendBaseUrl(): void {
  backendStorage()?.removeItem(STORAGE_KEY)
}
