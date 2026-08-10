/** CORS helpers for the plugin backend when called from the Hermes dashboard. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parse as parseYaml } from 'yaml'

export const DEFAULT_CORS_ORIGIN = 'http://127.0.0.1:9119'

type AllowedOrigin = string

/** Returns true when the origin is a well-formed http(s) URL with only an origin. */
export function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    // Origins must not carry path/query/userinfo; URL() normalizes those away when
    // parsing a bare origin, so compare against the reconstructed origin.
    return url.origin === origin
  } catch {
    return false
  }
}

/** Returns true when the origin is a localhost / 127.0.0.1 / ::1 URL. */
export function isLoopbackOrigin(origin: string): boolean {
  if (!isHttpOrigin(origin)) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

/** Parses a comma-separated origin allowlist from an environment value. */
export function parseOriginAllowlist(value: string | undefined): AllowedOrigin[] {
  if (!value?.trim()) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && isHttpOrigin(part))
}

/** Reads explicit CORS origins from PI_LIVECRAFT_CORS_ORIGIN (comma-separated). */
function readConfiguredOrigins(): AllowedOrigin[] {
  return parseOriginAllowlist(process.env.PI_LIVECRAFT_CORS_ORIGIN)
}

/** Reads the Hermes dashboard public URL origin from ~/.hermes/config.yaml when set. */
export function readHermesDashboardOrigin(
  configPath = join(homedir(), '.hermes', 'config.yaml'),
): AllowedOrigin | undefined {
  try {
    const raw = readFileSync(configPath, 'utf8')
    const config = parseYaml(raw) as { dashboard?: { public_url?: unknown } } | null
    const publicUrl = config?.dashboard?.public_url
    if (typeof publicUrl !== 'string' || !publicUrl.trim()) return undefined
    return new URL(publicUrl.trim()).origin
  } catch {
    return undefined
  }
}

/**
 * Returns the allowed origin for the request, or undefined to omit ACAO.
 *
 * The backend listens on 127.0.0.1 only, so browser CORS is the remaining
 * gate. Default policy mirrors any well-formed http(s) Origin so reverse-proxied
 * Hermes dashboards (e.g. https://example.com) work with zero plugin config.
 *
 * When PI_LIVECRAFT_CORS_ORIGIN is set, the allowlist is strict: only those
 * origins, loopback, the Hermes dashboard.public_url origin, and the default
 * local dashboard origin are accepted.
 */
export function resolveAllowedOrigin(origin: string | undefined): AllowedOrigin | undefined {
  if (!origin || !isHttpOrigin(origin)) return undefined

  const configured = readConfiguredOrigins()
  if (configured.length > 0) {
    if (isLoopbackOrigin(origin)) return origin
    const hermesOrigin = readHermesDashboardOrigin()
    const strictAllowlist = [
      ...configured,
      ...(hermesOrigin ? [hermesOrigin] : []),
      DEFAULT_CORS_ORIGIN,
    ]
    if (strictAllowlist.includes(origin)) return origin
    return undefined
  }

  // Zero-config default: mirror the browser Origin. Safe for a loopback-bound API.
  return origin
}

/** Applies CORS headers for dashboard plugin requests. */
export function applyCorsHeaders(
  response: ServerResponse,
  requestOrigin: string | undefined,
): void {
  const allowed = resolveAllowedOrigin(requestOrigin)
  if (allowed) {
    response.setHeader('Access-Control-Allow-Origin', allowed)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

/** Returns the Origin header when present on the request. */
export function requestOrigin(request: IncomingMessage): string | undefined {
  const origin = request.headers.origin
  return typeof origin === 'string' ? origin : undefined
}

/** Handles CORS preflight requests before route handlers run. */
export function handleCorsPreflight(request: IncomingMessage, response: ServerResponse): boolean {
  if ((request.method ?? 'GET') !== 'OPTIONS') return false
  applyCorsHeaders(response, requestOrigin(request))
  response.writeHead(204)
  response.end()
  return true
}
