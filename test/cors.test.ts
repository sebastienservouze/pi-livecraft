import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCorsHeaders,
  DEFAULT_CORS_ORIGIN,
  handleCorsPreflight,
  requestOrigin,
} from '../server/cors.ts'

function mockResponse() {
  const state = { status: 0, ended: false }
  const headers = new Map<string, string>()
  return {
    get status() {
      return state.status
    },
    get ended() {
      return state.ended
    },
    headers,
    setHeader(name: string, value: string) {
      headers.set(name, value)
    },
    writeHead(nextStatus: number) {
      state.status = nextStatus
    },
    end() {
      state.ended = true
    },
  }
}

test('applyCorsHeaders mirrors the allowed dashboard origin', () => {
  const response = mockResponse()
  applyCorsHeaders(response as never, DEFAULT_CORS_ORIGIN, DEFAULT_CORS_ORIGIN)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), DEFAULT_CORS_ORIGIN)
  assert.equal(response.headers.get('Vary'), 'Origin')
  assert.match(response.headers.get('Access-Control-Allow-Methods') ?? '', /POST/)
})

test('applyCorsHeaders ignores unknown origins', () => {
  const response = mockResponse()
  applyCorsHeaders(response as never, 'http://evil.test', DEFAULT_CORS_ORIGIN)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), undefined)
})

test('handleCorsPreflight answers OPTIONS with 204', () => {
  const response = mockResponse()
  const handled = handleCorsPreflight(
    { method: 'OPTIONS', headers: { origin: DEFAULT_CORS_ORIGIN } } as never,
    response as never,
    DEFAULT_CORS_ORIGIN,
  )
  assert.equal(handled, true)
  assert.equal(response.status, 204)
  assert.equal(response.ended, true)
})

test('requestOrigin returns the Origin header when present', () => {
  assert.equal(
    requestOrigin({ headers: { origin: DEFAULT_CORS_ORIGIN } } as never),
    DEFAULT_CORS_ORIGIN,
  )
  assert.equal(requestOrigin({ headers: {} } as never), undefined)
})
