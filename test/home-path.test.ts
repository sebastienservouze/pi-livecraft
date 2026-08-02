import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { expandHomePath } from '../server/home-path.ts'

test('expands slash and backslash home shorthand before backend canonicalization', () => {
  const projectPath = resolve(homedir(), 'projects')
  assert.equal(expandHomePath('~/projects'), projectPath)
  assert.equal(expandHomePath('~\\projects'), projectPath)
})
