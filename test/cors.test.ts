import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  applyCorsHeaders,
  handleCorsPreflight,
  isHttpOrigin,
  isLoopbackOrigin,
  parseOriginAllowlist,
  readHermesDashboardOrigin,
  requestOrigin,
  resolveAllowedOrigin,
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

test('isHttpOrigin accepts bare http(s) origins only', () => {
  assert.equal(isHttpOrigin('https://spy.neverpussy.com'), true)
  assert.equal(isHttpOrigin('http://127.0.0.1:9119'), true)
  assert.equal(isHttpOrigin('https://spy.neverpussy.com/hermes'), false)
  assert.equal(isHttpOrigin('ftp://example.com'), false)
})

test('isLoopbackOrigin accepts localhost variants on http only', () => {
  assert.equal(isLoopbackOrigin('http://127.0.0.1:49119'), true)
  assert.equal(isLoopbackOrigin('http://localhost:9119'), true)
  assert.equal(isLoopbackOrigin('http://[::1]:9119'), true)
  assert.equal(isLoopbackOrigin('https://127.0.0.1:9119'), false)
  assert.equal(isLoopbackOrigin('https://spy.neverpussy.com'), false)
})

test('resolveAllowedOrigin mirrors remote https origins by default', () => {
  const previous = process.env.PI_LIVECRAFT_CORS_ORIGIN
  delete process.env.PI_LIVECRAFT_CORS_ORIGIN
  try {
    assert.equal(
      resolveAllowedOrigin('https://spy.neverpussy.com'),
      'https://spy.neverpussy.com',
    )
    assert.equal(resolveAllowedOrigin('http://localhost:9119'), 'http://localhost:9119')
  } finally {
    if (previous === undefined) delete process.env.PI_LIVECRAFT_CORS_ORIGIN
    else process.env.PI_LIVECRAFT_CORS_ORIGIN = previous
  }
})

test('resolveAllowedOrigin becomes strict when PI_LIVECRAFT_CORS_ORIGIN is set', () => {
  const previous = process.env.PI_LIVECRAFT_CORS_ORIGIN
  process.env.PI_LIVECRAFT_CORS_ORIGIN = 'https://spy.neverpussy.com'
  try {
    assert.equal(
      resolveAllowedOrigin('https://spy.neverpussy.com'),
      'https://spy.neverpussy.com',
    )
    assert.equal(resolveAllowedOrigin('http://127.0.0.1:9119'), 'http://127.0.0.1:9119')
    assert.equal(resolveAllowedOrigin('https://evil.com'), undefined)
  } finally {
    if (previous === undefined) delete process.env.PI_LIVECRAFT_CORS_ORIGIN
    else process.env.PI_LIVECRAFT_CORS_ORIGIN = previous
  }
})

test('parseOriginAllowlist splits and validates origins', () => {
  assert.deepEqual(
    parseOriginAllowlist('https://a.example, http://127.0.0.1:9119, nope'),
    ['https://a.example', 'http://127.0.0.1:9119'],
  )
})

test('readHermesDashboardOrigin reads dashboard.public_url', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-cors-'))
  const path = join(dir, 'config.yaml')
  writeFileSync(
    path,
    'dashboard:\n  public_url: https://spy.neverpussy.com/\n  theme: cyberpunk\n',
    'utf8',
  )
  assert.equal(readHermesDashboardOrigin(path), 'https://spy.neverpussy.com')
})

test('applyCorsHeaders mirrors the request origin when present', () => {
  const previous = process.env.PI_LIVECRAFT_CORS_ORIGIN
  delete process.env.PI_LIVECRAFT_CORS_ORIGIN
  try {
    const response = mockResponse()
    applyCorsHeaders(response as never, 'https://spy.neverpussy.com')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://spy.neverpussy.com')
    assert.equal(response.headers.get('Vary'), 'Origin')
    assert.match(response.headers.get('Access-Control-Allow-Methods') ?? '', /POST/)
  } finally {
    if (previous === undefined) delete process.env.PI_LIVECRAFT_CORS_ORIGIN
    else process.env.PI_LIVECRAFT_CORS_ORIGIN = previous
  }
})

test('applyCorsHeaders sets no origin header when no origin is present', () => {
  const response = mockResponse()
  applyCorsHeaders(response as never, undefined)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), undefined)
})

test('handleCorsPreflight answers OPTIONS with 204', () => {
  const previous = process.env.PI_LIVECRAFT_CORS_ORIGIN
  delete process.env.PI_LIVECRAFT_CORS_ORIGIN
  try {
    const response = mockResponse()
    const handled = handleCorsPreflight(
      { method: 'OPTIONS', headers: { origin: 'https://spy.neverpussy.com' } } as never,
      response as never,
    )
    assert.equal(handled, true)
    assert.equal(response.status, 204)
    assert.equal(response.ended, true)
    assert.equal(
      response.headers.get('Access-Control-Allow-Origin'),
      'https://spy.neverpussy.com',
    )
  } finally {
    if (previous === undefined) delete process.env.PI_LIVECRAFT_CORS_ORIGIN
    else process.env.PI_LIVECRAFT_CORS_ORIGIN = previous
  }
})

test('requestOrigin returns the Origin header when present', () => {
  assert.equal(
    requestOrigin({ headers: { origin: 'http://127.0.0.1:49119' } } as never),
    'http://127.0.0.1:49119',
  )
  assert.equal(requestOrigin({ headers: {} } as never), undefined)
})
