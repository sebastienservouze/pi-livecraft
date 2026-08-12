import assert from 'node:assert/strict'
import test from 'node:test'
import { terminalLines, type TerminalSpan } from '../src/features/shell/terminal-output.ts'

function text(spans: TerminalSpan[]): string {
  return spans.map((span) => span.text).join('')
}

test('découpe la sortie en lignes', () => {
  const lines = terminalLines('first\nsecond\n')
  assert.deepEqual(lines.map(text), ['first', 'second', ''])
})

test('réécrit la ligne sur un retour chariot', () => {
  assert.equal(text(terminalLines('50%\r100%')[0]), '100%')
  assert.equal(text(terminalLines('abcdef\rxy')[0]), 'xycdef')
})

test('applique le retour arrière et les tabulations', () => {
  assert.equal(text(terminalLines('abc\b\bZ')[0]), 'aZc')
  assert.equal(text(terminalLines('a\tb')[0]), 'a       b')
})

test('traduit les couleurs SGR en classes et retire les autres séquences', () => {
  const [line] = terminalLines('\u001b[31mfail\u001b[0m ok\u001b[?25h')
  assert.deepEqual(line.map((span) => [span.text, span.className]), [
    ['fail', 'ansi-red'],
    [' ok', ''],
  ])
  assert.equal(text(terminalLines('\u001b[1;32mdone\u001b[0m')[0]), 'done')
  assert.equal(terminalLines('\u001b[1;32mdone')[0][0].className, 'ansi-green ansi-bold')
})

test('efface l’écran sur la séquence dédiée', () => {
  assert.deepEqual(terminalLines('old\n\u001b[2Jnew').map(text), ['new'])
})

test('ignore un titre de fenêtre et une séquence incomplète', () => {
  assert.equal(text(terminalLines('\u001b]0;title\u0007prompt$ ')[0]), 'prompt$ ')
  assert.equal(text(terminalLines('value\u001b[3')[0]), 'value')
})
