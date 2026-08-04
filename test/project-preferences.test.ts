import assert from 'node:assert/strict'
import test from 'node:test'
import { toggleProjectPath } from '../src/features/workspace/project-preferences.ts'

test('toggleProjectPath adds a missing path, preserving existing order', () => {
  assert.deepEqual(toggleProjectPath(['/a'], '/b'), ['/a', '/b'])
})

test('toggleProjectPath removes a present path', () => {
  assert.deepEqual(toggleProjectPath(['/a', '/b'], '/a'), ['/b'])
})

test('toggleProjectPath round-trips to the original list', () => {
  const once = toggleProjectPath(['/a'], '/b')
  assert.deepEqual(toggleProjectPath(once, '/b'), ['/a'])
})
