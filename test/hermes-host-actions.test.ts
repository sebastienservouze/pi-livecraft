import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HERMES_CHAT_PATH,
  HERMES_FILES_PATH,
  isHermesDashboardHost,
  openFolderAction,
  openHermesDashboardRoute,
  openTerminalAction,
} from '../src/features/terminal/hermes-host-actions.ts'

test('detects the Hermes dashboard host from SDK globals', () => {
  assert.equal(isHermesDashboardHost({}), false)
  assert.equal(isHermesDashboardHost({ __HERMES_PLUGIN_SDK__: {} }), true)
  assert.equal(isHermesDashboardHost({ __HERMES_PLUGINS__: {} }), true)
})

test('openHermesDashboardRoute assigns a root-relative dashboard path', () => {
  const assigned: string[] = []
  openHermesDashboardRoute('files', (url) => assigned.push(url))
  openHermesDashboardRoute('/chat', (url) => assigned.push(url))
  assert.deepEqual(assigned, [HERMES_FILES_PATH, HERMES_CHAT_PATH])
})

test('openFolderAction uses Hermes Files inside the dashboard', async () => {
  const routes: string[] = []
  let osCalled = false
  await openFolderAction(async () => {
    osCalled = true
  }, {
    isHermes: true,
    openRoute: (path) => routes.push(path),
  })
  assert.deepEqual(routes, [HERMES_FILES_PATH])
  assert.equal(osCalled, false)
})

test('openTerminalAction uses Hermes Chat inside the dashboard', async () => {
  const routes: string[] = []
  let osCalled = false
  await openTerminalAction(async () => {
    osCalled = true
  }, {
    isHermes: true,
    openRoute: (path) => routes.push(path),
  })
  assert.deepEqual(routes, [HERMES_CHAT_PATH])
  assert.equal(osCalled, false)
})

test('openFolderAction and openTerminalAction keep OS launchers outside Hermes', async () => {
  let explorer = 0
  let terminal = 0
  await openFolderAction(async () => {
    explorer += 1
  }, { isHermes: false })
  await openTerminalAction(async () => {
    terminal += 1
  }, { isHermes: false })
  assert.equal(explorer, 1)
  assert.equal(terminal, 1)
})
