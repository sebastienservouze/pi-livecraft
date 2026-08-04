import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composeThreadTitle,
  displayThreadTitle,
  promptSessionTitle,
} from '../src/features/composer/prompt-title.ts'

test('normalizes and truncates the prompt used as the immediate session title', () => {
  assert.equal(promptSessionTitle('  First\n\tprompt  '), 'First prompt')
  assert.equal(promptSessionTitle('a'.repeat(100)), `${'a'.repeat(89)}…`)
})

test('composeThreadTitle joins worker and context, and falls back to a default worker', () => {
  assert.equal(composeThreadTitle('glmpi', 'Livecraft bootstrap'), 'glmpi — Livecraft bootstrap')
  assert.equal(composeThreadTitle('', 'Only context'), 'Pi — Only context')
  assert.equal(composeThreadTitle('glmpi', ''), 'glmpi')
})

test('displayThreadTitle never renders a blank or generic thread title', () => {
  assert.equal(displayThreadTitle('', 'glmpi'), 'glmpi')
  assert.equal(displayThreadTitle('Nouvelle session', 'glmpi'), 'glmpi')
  assert.equal(displayThreadTitle('New session', undefined), 'Pi')
  assert.equal(displayThreadTitle(undefined, undefined), 'Pi')
})

test('displayThreadTitle prefixes the worker and preserves it across a later Pi rename', () => {
  assert.equal(displayThreadTitle('First prompt', 'glmpi'), 'glmpi — First prompt')
  // A Pi-generated rename arrives as plain context; the current worker is re-applied.
  assert.equal(displayThreadTitle('Generated title', 'glmpi'), 'glmpi — Generated title')
  // Re-composition is idempotent when the stored value already carries the same worker prefix.
  assert.equal(displayThreadTitle('Pi — First prompt', 'Pi'), 'Pi — First prompt')
})
