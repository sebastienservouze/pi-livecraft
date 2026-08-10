/** CORS helpers for the Pi Livecraft backend when called from the Hermes dashboard. */
import type { IncomingMessage, ServerResponse } from 'node:http'

export const DEFAULT_CORS_ORIGIN = 'http://127.0.0.1:9119'

/** Reads the allowed browser origin for cross-origin dashboard plugin requests. */
export function readCorsOrigin(): string {
  const value = process.env.PI_LIVECRAFT_CORS_ORIGIN?.trim()
  return value || DEFAULT_CORS_ORIGIN
}

/** Applies CORS headers for dashboard plugin requests. */
export function applyCorsHeaders(
  response: ServerResponse,
  requestOrigin: string | undefined,
  allowedOrigin = readCorsOrigin(),
): void {
  if (requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
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
export function handleCorsPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin = readCorsOrigin(),
): boolean {
  if ((request.method ?? 'GET') !== 'OPTIONS') return false
  applyCorsHeaders(response, requestOrigin(request), allowedOrigin)
  response.writeHead(204)
  response.end()
  return true
}
