import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const repoRoot = join(import.meta.dirname, '..')

test('Hermes install artifacts are present', () => {
  assert.ok(existsSync(join(repoRoot, 'plugin.yaml')))
  assert.ok(existsSync(join(repoRoot, 'after-install.md')))
  assert.ok(existsSync(join(repoRoot, '__init__.py')))
  assert.ok(existsSync(join(repoRoot, 'hermes_plugin/runtime.py')))
  assert.ok(existsSync(join(repoRoot, 'dashboard/dist/index.js')))
  assert.ok(existsSync(join(repoRoot, 'dashboard/dist/style.css')))
})

test('plugin.yaml matches dashboard manifest name and version', () => {
  const pluginYaml = readFileSync(join(repoRoot, 'plugin.yaml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'dashboard/manifest.json'), 'utf8'))

  assert.match(pluginYaml, /^name: hermes-pi-coding-ui-plugin/m)
  assert.match(pluginYaml, /^version: 1\.2\.0/m)
  assert.equal(manifest.name, 'hermes-pi-coding-ui-plugin')
  assert.equal(manifest.version, '1.2.0')
  assert.equal(manifest.entry, 'dist/index.js')
})

test('after-install.md documents install flow commands', () => {
  const content = readFileSync(join(repoRoot, 'after-install.md'), 'utf8')
  assert.match(content, /hermes pi-coding-ui start/)
  assert.match(content, /hermes dashboard/)
  assert.match(content, /plugins\/rescan/)
})

test('plugin entrypoint uses a relative hermes_plugin import for Hermes loading', () => {
  const content = readFileSync(join(repoRoot, '__init__.py'), 'utf8')
  assert.match(content, /from \.hermes_plugin import runtime/)
  assert.doesNotMatch(content, /^from hermes_plugin import runtime/m)
})
