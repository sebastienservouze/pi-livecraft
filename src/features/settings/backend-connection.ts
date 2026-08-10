const STORAGE_KEY = 'pi-livecraft.backend-url'
export const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:43121'

type BackendStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function backendStorage(): BackendStorage | undefined {
  return (globalThis as typeof globalThis & { localStorage?: BackendStorage }).localStorage
}

/** Normalizes a backend base URL for fetch and EventSource calls. */
export function normalizeBackendBaseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/** Reads the persisted backend base URL, falling back to the default local service. */
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
  return DEFAULT_BACKEND_BASE_URL
}

/** Persists the backend base URL after validation. */
export function persistBackendBaseUrl(value: string): string {
  const normalized = normalizeBackendBaseUrl(value)
  if (!normalized) throw new Error('Enter a valid backend URL such as http://127.0.0.1:43121')
  backendStorage()?.setItem(STORAGE_KEY, normalized)
  return normalized
}

/** Resolves the backend base URL used by the frontend HTTP boundary. */
export function resolveBackendBaseUrl(): string {
  return readBackendBaseUrl()
}

/** Clears a custom backend URL and restores the default local service. */
export function resetBackendBaseUrl(): void {
  backendStorage()?.removeItem(STORAGE_KEY)
}
