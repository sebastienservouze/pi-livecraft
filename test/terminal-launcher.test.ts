import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultTerminalInvocations,
  parseTerminalTemplate,
  tokenizeTemplate,
  TerminalTemplateError,
} from '../server/features/terminal/launcher.ts'

test('tokenizes a simple command', () => {
  assert.deepEqual(tokenizeTemplate('wt.exe -d {cwd}'), ['wt.exe', '-d', '{cwd}'])
})

test('strips double quotes around a token', () => {
  assert.deepEqual(tokenizeTemplate('cmd "arg with spaces"'), ['cmd', 'arg with spaces'])
})

test('handles backslash escapes without corrupting Windows paths', () => {
  assert.deepEqual(tokenizeTemplate('cmd arg\\ with\\ spaces'), ['cmd', 'arg with spaces'])
  assert.deepEqual(
    tokenizeTemplate('wt.exe -d "C:\\Users\\Jane Doe\\project"'),
    ['wt.exe', '-d', 'C:\\Users\\Jane Doe\\project'],
  )
  assert.deepEqual(tokenizeTemplate('cmd \\\\server\\share\\project'), [
    'cmd',
    '\\\\server\\share\\project',
  ])
})

test('collapses multiple spaces outside quotes', () => {
  assert.deepEqual(tokenizeTemplate('cmd   -d    {cwd}'), ['cmd', '-d', '{cwd}'])
})

test('replaces {cwd} with the workspace path', () => {
  const result = parseTerminalTemplate('wt.exe -d {cwd}', '/home/user')
  assert.deepEqual(result, { command: 'wt.exe', args: ['-d', '/home/user'] })
})

test('replaces {cwd} inside a longer token', () => {
  const result = parseTerminalTemplate('cmd --path={cwd}/src', '/home/user')
  assert.deepEqual(result, { command: 'cmd', args: ['--path=/home/user/src'] })
})

test('uses the platform terminal defaults', () => {
  assert.deepEqual(defaultTerminalInvocations('/home/user', 'linux'), [{
    command: 'x-terminal-emulator',
    args: [],
    cwd: '/home/user',
  }])
  assert.deepEqual(
    defaultTerminalInvocations('/home/user', 'wsl', { WSL_DISTRO_NAME: 'Ubuntu-22.04' }),
    [{
      command: 'wt.exe',
      args: ['nt', '--', 'wsl.exe', '-d', 'Ubuntu-22.04', '--cd', '/home/user'],
    }],
  )
  assert.deepEqual(defaultTerminalInvocations('C:\\work', 'windows'), [
    { command: 'wt.exe', args: ['-d', 'C:\\work'] },
    { command: 'powershell.exe', args: ['-NoExit'], cwd: 'C:\\work' },
  ])
})

test('falls back to the default WSL distribution when its name is unavailable', () => {
  assert.deepEqual(
    defaultTerminalInvocations('/home/user', 'wsl', { WSL_INTEROP: '/run/WSL/1_interop' }),
    [{ command: 'wt.exe', args: ['nt', '--', 'wsl.exe', '--cd', '/home/user'] }],
  )
})

test('replaces {cwd} inside a quoted token', () => {
  const result = parseTerminalTemplate('wezterm start --cwd "{cwd}"', '/home/user')
  assert.deepEqual(result, { command: 'wezterm', args: ['start', '--cwd', '/home/user'] })
})

test('replaces multiple {cwd} occurrences', () => {
  const result = parseTerminalTemplate('cmd {cwd} {cwd}/out', '/tmp')
  assert.deepEqual(result, { command: 'cmd', args: ['/tmp', '/tmp/out'] })
})

test('rejects a template without {cwd}', () => {
  assert.throws(() => parseTerminalTemplate('wt.exe -d .', '/home/user'), TerminalTemplateError)
})

test('rejects an empty template', () => {
  assert.throws(() => parseTerminalTemplate('', '/home/user'), TerminalTemplateError)
})

test('rejects a whitespace-only template', () => {
  assert.throws(() => parseTerminalTemplate('   ', '/home/user'), TerminalTemplateError)
})

test('rejects unclosed double quotes', () => {
  assert.throws(() => tokenizeTemplate('cmd "unclosed'), TerminalTemplateError)
})

test('rejects a template exceeding the length limit', () => {
  const long = `wt.exe -d {cwd} ${'x'.repeat(2000)}`
  assert.throws(() => parseTerminalTemplate(long, '/home/user'), TerminalTemplateError)
})

test('rejects a template with NUL characters', () => {
  assert.throws(
    () => parseTerminalTemplate('wt.exe\0 -d {cwd}', '/home/user'),
    TerminalTemplateError,
  )
})
