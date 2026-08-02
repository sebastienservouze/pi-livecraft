import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  defaultTerminalInvocation,
  parseTerminalTemplate,
  tokenizeTemplate,
  TerminalTemplateError,
  openTerminalApplication,
} from '../server/features/terminal/launcher.ts'

test('tokenizes a simple command', () => {
  assert.deepEqual(tokenizeTemplate('wt.exe -d {cwd}'), ['wt.exe', '-d', '{cwd}'])
})

test('strips double quotes around a token', () => {
  assert.deepEqual(tokenizeTemplate('cmd "arg with spaces"'), ['cmd', 'arg with spaces'])
})

test('handles escaped whitespace while retaining Windows backslashes', () => {
  assert.deepEqual(tokenizeTemplate('cmd arg\\ with\\ spaces'), ['cmd', 'arg with spaces'])
  assert.deepEqual(tokenizeTemplate('"C:\\Program Files\\Tool.exe" "\\\\server\\share\\"'), [
    'C:\\Program Files\\Tool.exe',
    '\\\\server\\share\\',
  ])
  assert.deepEqual(tokenizeTemplate('cmd "a""b" C:\\trailing\\'), ['cmd', 'a"b', 'C:\\trailing\\'])
  assert.deepEqual(tokenizeTemplate(String.raw`cmd "a\"b" {cwd}`), ['cmd', 'a"b', '{cwd}'])
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
  assert.deepEqual(defaultTerminalInvocation('/home/user', 'linux'), {
    command: 'x-terminal-emulator',
    args: [],
    cwd: '/home/user',
  })
  assert.deepEqual(
    defaultTerminalInvocation('/home/user', 'wsl', { WSL_DISTRO_NAME: 'Ubuntu-22.04' }),
    {
      command: 'wt.exe',
      args: ['nt', '--', 'wsl.exe', '-d', 'Ubuntu-22.04', '--cd', '/home/user'],
    },
  )
})

test('uses Windows Terminal in a new native Windows window', () => {
  assert.deepEqual(defaultTerminalInvocation('C:\\hostile & ü', 'windows'), {
    command: 'wt.exe',
    args: ['--window', 'new', '--startingDirectory', 'C:\\hostile & ü'],
  })
})

test('tries the next visible native Windows default only when the previous spawn fails', async () => {
  const calls: Array<{ command: string; windowsHide?: boolean }> = []
  await openTerminalApplication(
    'C:\\hostile & ü',
    undefined,
    'windows',
    ((command: string, _args: string[], options: { windowsHide?: boolean }) => {
      calls.push({ command, windowsHide: options.windowsHide })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() => child.emit(calls.length === 1 ? 'error' : 'spawn', new Error('missing')))
      return child as never
    }) as never,
  )
  assert.deepEqual(calls, [
    { command: 'wt.exe', windowsHide: false },
    { command: 'alacritty.exe', windowsHide: false },
  ])
})

test('launches custom terminal commands visibly', async () => {
  let windowsHide: boolean | undefined
  await openTerminalApplication(
    'C:\\workspace',
    'custom-terminal --cwd {cwd}',
    'windows',
    ((_command: string, _args: string[], options: { windowsHide?: boolean }) => {
      windowsHide = options.windowsHide
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    }) as never,
  )
  assert.equal(windowsHide, false)
})

test('hides brokered shells, waits for them, and continues after a broker failure', async () => {
  const calls: Array<{ command: string; windowsHide?: boolean }> = []
  await openTerminalApplication(
    'C:\\hostile & ü',
    undefined,
    'windows',
    ((
      command: string,
      _args: string[],
      options: { env?: NodeJS.ProcessEnv; windowsHide?: boolean },
    ) => {
      const target = options.env?.PI_LIVECRAFT_TERMINAL_SHELL
      calls.push({ command: target ?? command, windowsHide: options.windowsHide })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() => {
        if (!target) child.emit('error', new Error('missing'))
        else child.emit('exit', target === 'pwsh.exe' ? 1 : 0)
      })
      return child as never
    }) as never,
  )
  assert.deepEqual(calls, [
    { command: 'wt.exe', windowsHide: false },
    { command: 'alacritty.exe', windowsHide: false },
    { command: 'wezterm.exe', windowsHide: false },
    { command: 'pwsh.exe', windowsHide: true },
    { command: 'powershell.exe', windowsHide: true },
  ])
})

test('falls back to the default WSL distribution when its name is unavailable', () => {
  assert.deepEqual(
    defaultTerminalInvocation('/home/user', 'wsl', { WSL_INTEROP: '/run/WSL/1_interop' }),
    { command: 'wt.exe', args: ['nt', '--', 'wsl.exe', '--cd', '/home/user'] },
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
