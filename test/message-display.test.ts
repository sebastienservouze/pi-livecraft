import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantErrorMessage,
  isVisibleConversationMessage,
  reasoningTextForDisplay,
} from '../src/features/conversation/message-display.ts'

test('makes an errored assistant turn visible and exposes its provider error', () => {
  const message = {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: 'OpenAI API error (400): unsupported reasoning effort',
  }

  assert.equal(isVisibleConversationMessage(message), true)
  assert.equal(assistantErrorMessage(message), message.errorMessage)
})

test('does not treat arbitrary or successful assistant metadata as a visible error', () => {
  assert.equal(assistantErrorMessage({ role: 'assistant', errorMessage: 'Oops' }), null)
  assert.equal(
    isVisibleConversationMessage({
      role: 'assistant',
      content: [],
      stopReason: 'stop',
      errorMessage: 'Oops',
    }),
    false,
  )
})

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
