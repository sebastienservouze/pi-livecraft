import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BACKEND_BASE_URL,
  HERMES_PLUGIN_BACKEND_PATH,
  hermesPluginBackendBaseUrl,
  normalizeBackendBaseUrl,
} from '../src/features/settings/backend-connection.ts'
import { PLUGIN_NAME, registerPiLivecraftPlugin } from '../src/plugin/register-plugin.ts'

test('registerPiLivecraftPlugin registers the App component', () => {
  const App = function App() {}
  const calls: Array<{ name: string; component: unknown }> = []
  registerPiLivecraftPlugin(
    App,
    { register: (name, component) => calls.push({ name, component }) },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.name, PLUGIN_NAME)
  assert.equal(calls[0]?.component, App)
})

test('registerPiLivecraftPlugin logs when the registry is missing', () => {
  const messages: string[] = []
  registerPiLivecraftPlugin(function App() {}, undefined, (message) => messages.push(message))
  assert.deepEqual(messages, [`${PLUGIN_NAME}: window.__HERMES_PLUGINS__ not found`])
})

test('normalizeBackendBaseUrl accepts an origin-only http URL', () => {
  assert.equal(normalizeBackendBaseUrl('http://127.0.0.1:43121'), DEFAULT_BACKEND_BASE_URL)
})

test('normalizeBackendBaseUrl accepts the Hermes plugin mount path', () => {
  assert.equal(
    normalizeBackendBaseUrl('https://example.com/api/plugins/hermes-pi-coding-ui-plugin/'),
    `https://example.com${HERMES_PLUGIN_BACKEND_PATH}`,
  )
})

test('normalizeBackendBaseUrl rejects query strings, credentials, and invalid protocols', () => {
  assert.equal(normalizeBackendBaseUrl('http://127.0.0.1:43121/api?debug=1'), null)
  assert.equal(normalizeBackendBaseUrl('ftp://127.0.0.1:43121'), null)
  assert.equal(normalizeBackendBaseUrl('http://user:pass@127.0.0.1:43121'), null)
})

test('hermesPluginBackendBaseUrl uses the dashboard origin when available', () => {
  type GlobalWithLocation = typeof globalThis & { location?: { origin: string } }
  const globalWithLocation = globalThis as GlobalWithLocation
  const previous = globalWithLocation.location
  globalWithLocation.location = { origin: 'https://example.com' }
  try {
    assert.equal(
      hermesPluginBackendBaseUrl(),
      `https://example.com${HERMES_PLUGIN_BACKEND_PATH}`,
    )
  } finally {
    if (previous === undefined) delete globalWithLocation.location
    else globalWithLocation.location = previous
  }
})
