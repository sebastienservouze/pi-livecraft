import assert from 'node:assert/strict'
import test from 'node:test'
import { reasoningTextForDisplay } from '../src/features/conversation/message-display.ts'

test('removes standard CSI SGR truecolor styling and resets', () => {
  assert.equal(
    reasoningTextForDisplay(
      'assistant',
      '\x1b[38;2;56;189;248mThinking:\x1b[39m details\x1b[0m',
    ),
    'Thinking: details',
  )
})

test('removes C1 CSI SGR sequences', () => {
  assert.equal(
    reasoningTextForDisplay('assistant', '\x9b1;38;2;56;189;248mThinking\x9b0m'),
    'Thinking',
  )
})

test('preserves Markdown, bracketed text, and non-SGR controls', () => {
  const text = '[38;2;56;189;248m **Markdown** \x1b[2J'

  assert.equal(reasoningTextForDisplay('assistant', text), text)

  const styledCustomContent = '\x1b[31mextension-owned\x1b[0m'
  assert.equal(reasoningTextForDisplay('custom', styledCustomContent), styledCustomContent)
})
