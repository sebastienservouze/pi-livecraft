import assert from 'node:assert/strict'
import test from 'node:test'
import {
  editDiffDisplayLines,
  fileUrl,
  formatToolCallTooltip,
  intraLineDiff,
  parseEditDiff,
  readContentDisplay,
  toolCallPresentation,
  toolDataLength,
  toolEditChanges,
  toolFilePath,
  toolTextPreview,
  truncateToolText,
} from '../src/features/conversation/tool-presentation.ts'

test('extracts valid edit replacements without accepting malformed entries', () => {
  assert.deepEqual(
    toolEditChanges({
      edits: [
        { oldText: 'before', newText: 'after' },
        { oldText: '', newText: 'inserted' },
        { oldText: 'missing replacement' },
      ],
    }),
    [
      { oldText: 'before', newText: 'after' },
      { oldText: '', newText: 'inserted' },
    ],
  )
  assert.deepEqual(toolEditChanges({ edits: 'not an array' }), [])
})

test('measures serialized arguments and adds input and output sizes below the full tool title', () => {
  assert.equal(toolDataLength({ command: 'pwd' }), 17)
  assert.equal(formatToolCallTooltip('pwd', 17), 'pwd\nCall: 17 characters')
  assert.equal(
    formatToolCallTooltip('pwd', 17, 0),
    'pwd\nCall: 17 characters · Result: 0 characters',
  )
})

test('truncates text only after 140 characters', () => {
  const limit = 'a'.repeat(140)
  assert.deepEqual(truncateToolText(limit), { text: limit, truncated: false })
  assert.deepEqual(truncateToolText(`${limit}b`), { text: `${limit}…`, truncated: true })
})

test('previews four lines and reports the remaining output', () => {
  assert.deepEqual(toolTextPreview('one\ntwo\nthree\nfour\nfive\nsix'), {
    text: 'one\ntwo\nthree\nfour…',
    remainingLineCount: 2,
  })
  assert.deepEqual(toolTextPreview('one\ntwo\nthree\nfour\n'), {
    text: 'one\ntwo\nthree\nfour\n',
    remainingLineCount: 0,
  })
})

test('builds browser file URLs from Linux, Windows, and WSL paths', () => {
  assert.equal(fileUrl('/home/ada/index.html'), 'file:///home/ada/index.html')
  assert.equal(
    fileUrl('C:\\Users\\Ada Lovelace\\index.html'),
    'file:///C:/Users/Ada%20Lovelace/index.html',
  )
  assert.equal(
    fileUrl('\\\\wsl.localhost\\Ubuntu\\home\\ada\\index.html'),
    'file://wsl.localhost/Ubuntu/home/ada/index.html',
  )
})

test('detects CSV, Markdown, HTML and supported code formats read from the repository', () => {
  assert.deepEqual(readContentDisplay({ path: 'data/export.csv' }), { kind: 'csv' })
  assert.deepEqual(readContentDisplay({ path: 'docs/guide.md' }), { kind: 'markdown' })
  assert.deepEqual(readContentDisplay({ path: 'src/App.tsx' }), {
    kind: 'code',
    language: 'typescript',
  })
  assert.deepEqual(readContentDisplay({ path: 'public/preview.html' }), { kind: 'html' })
  assert.deepEqual(readContentDisplay({ path: 'dist/favicon.svg' }), { kind: 'svg' })
  assert.deepEqual(readContentDisplay({ path: 'src/Program.cs' }), {
    kind: 'code',
    language: 'csharp',
  })
  assert.deepEqual(readContentDisplay({ path: 'notes.txt' }), { kind: 'text' })
  assert.deepEqual(readContentDisplay({}), { kind: 'text' })
})

test('extracts a usable file path from read and write calls', () => {
  assert.equal(toolFilePath({ path: 'src/App.tsx' }), 'src/App.tsx')
  assert.equal(toolFilePath({ path: '' }), null)
  assert.equal(toolFilePath({}), null)
})

test('uses the Bash presentation while preserving the generic fallback', () => {
  const command = 'a'.repeat(81)
  assert.deepEqual(
    toolCallPresentation({ id: 'call_1', name: 'bash', args: { command, timeout: 30 } }),
    {
      headerDetail: { text: `${'a'.repeat(80)}…`, title: command },
      pendingDetail: 'timeout: 30s',
    },
  )
  assert.deepEqual(toolCallPresentation({ id: 'call_2', name: 'bash', args: { timeout: 30 } }), {})
})

test('displays search patterns and their optional paths', () => {
  const root = '/workspace/repository'

  assert.deepEqual(
    toolCallPresentation({
      id: 'call_1',
      name: 'find',
      args: { pattern: 'tool call', path: `${root}/src` },
    }, root),
    {
      headerDetail: { text: 'tool call · src', title: 'tool call · src' },
    },
  )
  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_2', name: 'grep', args: { pattern: 'toolCallPresentation' } },
      root,
    ),
    {
      headerDetail: { text: 'toolCallPresentation', title: 'toolCallPresentation' },
    },
  )
  assert.deepEqual(
    toolCallPresentation({ id: 'call_3', name: 'find', args: { path: 'src' } }, root),
    {},
  )
})

test('displays file tool paths relative to the repository and truncates them', () => {
  const root = '/workspace/repository'
  const path = `${root}/src/${'a'.repeat(80)}`

  for (const name of ['read', 'edit', 'write']) {
    assert.deepEqual(toolCallPresentation({ id: 'call_1', name, args: { path } }, root), {
      headerDetail: { text: `src/${'a'.repeat(76)}…`, title: `src/${'a'.repeat(80)}` },
    })
  }
  assert.deepEqual(
    toolCallPresentation({ id: 'call_2', name: 'read', args: { path: '/tmp/file.txt' } }, root),
    {
      headerDetail: { text: '/tmp/file.txt', title: '/tmp/file.txt' },
    },
  )
  assert.deepEqual(toolCallPresentation({ id: 'call_3', name: 'read', args: {} }, root), {})
  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_4', name: 'read', args: { path: 'C:\\Work\\Repository\\src\\App.tsx' } },
      'C:/work/repository',
    ),
    { headerDetail: { text: 'src/App.tsx', title: 'src/App.tsx' } },
  )
  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_5', name: 'read', args: { path: '\\\\SERVER\\share\\repo\\README.md' } },
      '//server/share/repo',
    ),
    { headerDetail: { text: 'README.md', title: 'README.md' } },
  )
})

test('keeps the read range visible beside a truncated path', () => {
  const root = '/workspace/repository'
  const path = `${root}/src/${'a'.repeat(80)}`

  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_1', name: 'read', args: { path, offset: 41, limit: 20 } },
      root,
    ),
    {
      headerDetail: {
        text: `src/${'a'.repeat(76)}…`,
        title: `src/${'a'.repeat(80)}`,
        suffix: '[41:60]',
      },
    },
  )
  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_2', name: 'read', args: { path: 'src/App.tsx', limit: 60 } },
      root,
    ),
    {
      headerDetail: { text: 'src/App.tsx', title: 'src/App.tsx', suffix: '[1:60]' },
    },
  )
  assert.deepEqual(
    toolCallPresentation(
      { id: 'call_3', name: 'read', args: { path: 'src/App.tsx', offset: 0 } },
      root,
    ),
    {
      headerDetail: { text: 'src/App.tsx', title: 'src/App.tsx' },
    },
  )
})

test('parses Pi edit diff lines with added, removed, and context line numbers', () => {
  const diff = [
    ' 2   unchanged context',
    '-3   removed line',
    '+3   added line',
    ' 4   after change',
    '      ...',
  ]
    .join('\n')
  const parsed = parseEditDiff(diff)
  assert.deepEqual(parsed, [
    { content: '  unchanged context', kind: 'context', lineNumber: 2 },
    { content: '  removed line', kind: 'removed', lineNumber: 3 },
    { content: '  added line', kind: 'added', lineNumber: 3 },
    { content: '  after change', kind: 'context', lineNumber: 4 },
    { content: '...', kind: 'context', lineNumber: null },
  ])
})

test('parses diff with only insertions and only deletions', () => {
  const onlyAdded = parseEditDiff('+10 new file content')
  assert.deepEqual(onlyAdded[0], { content: 'new file content', kind: 'added', lineNumber: 10 })

  const onlyRemoved = parseEditDiff('-3 deprecated code')
  assert.deepEqual(onlyRemoved[0], { content: 'deprecated code', kind: 'removed', lineNumber: 3 })
})

test('intraLineDiff returns single shared segment for identical strings', () => {
  const segments = intraLineDiff('hello', 'hello')
  assert.deepEqual(segments, [{ text: 'hello', kind: 'shared' }])
})

test('intraLineDiff detects single word change', () => {
  const segments = intraLineDiff('const x = 1', 'const x = 2')
  assert.deepEqual(segments, [
    { text: 'const x = ', kind: 'shared' },
    { text: '1', kind: 'removed' },
    { text: '2', kind: 'added' },
  ])
})

test('intraLineDiff handles pure insertion', () => {
  const segments = intraLineDiff('hello', 'hello world')
  assert.deepEqual(segments, [
    { text: 'hello ', kind: 'shared' },
    { text: 'world', kind: 'added' },
  ])
})

test('matches Pi edit highlighting rules for tabs and multi-line changes', () => {
  const displayLines = editDiffDisplayLines(parseEditDiff([
    '-1 \tconst before = 1',
    '+1 \tconst after = 1',
    '-3 first removed',
    '-4 second removed',
    '+3 first added',
    '+4 second added',
  ]
    .join('\n')))

  assert.deepEqual(displayLines, [
    {
      content: '   const before = 1',
      kind: 'removed',
      lineNumber: 1,
      segments: [
        { text: '   const ', kind: 'shared' },
        { text: 'before', kind: 'removed' },
        { text: ' = 1', kind: 'shared' },
      ],
    },
    {
      content: '   const after = 1',
      kind: 'added',
      lineNumber: 1,
      segments: [
        { text: '   const ', kind: 'shared' },
        { text: 'after', kind: 'added' },
        { text: ' = 1', kind: 'shared' },
      ],
    },
    { content: 'first removed', kind: 'removed', lineNumber: 3 },
    { content: 'second removed', kind: 'removed', lineNumber: 4 },
    { content: 'first added', kind: 'added', lineNumber: 3 },
    { content: 'second added', kind: 'added', lineNumber: 4 },
  ])
})

test('intraLineDiff handles pure deletion', () => {
  const segments = intraLineDiff('hello world', 'hello')
  assert.deepEqual(segments, [
    { text: 'hello', kind: 'shared' },
    { text: ' ', kind: 'removed', highlighted: false },
    { text: 'world', kind: 'removed' },
  ])
})

test('intraLineDiff handles completely different strings', () => {
  const segments = intraLineDiff('abc', 'xyz')
  assert.deepEqual(segments, [
    { text: 'abc', kind: 'removed' },
    { text: 'xyz', kind: 'added' },
  ])
})

test('intraLineDiff returns empty array for empty inputs', () => {
  assert.deepEqual(intraLineDiff('', ''), [])
})
