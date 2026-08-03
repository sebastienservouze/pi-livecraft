import { spawn, type ChildProcess } from 'node:child_process'
import {
  getDesktopPlatform,
  getWslDistributionName,
  type DesktopPlatform,
} from '../../system-integration.ts'

const maxTemplateLength = 2000
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess

export class TerminalTemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalTemplateError'
  }
}

/** Tokenizes a command template without shell parsing for the selected desktop platform. */
export function tokenizeTemplate(
  template: string,
  platform: DesktopPlatform = getDesktopPlatform(),
): string[] {
  return platform === 'windows'
    ? tokenizeWindowsTemplate(template)
    : tokenizeLegacyTemplate(template)
}

function tokenizeLegacyTemplate(template: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false

  for (let index = 0; index < template.length; index += 1) {
    const ch = template[index]

    if (ch === '\\' && index + 1 < template.length) {
      current += template[index + 1]
      index += 1
      continue
    }

    if (ch === '"') {
      inQuote = !inQuote
      continue
    }

    if (ch === ' ' && !inQuote) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (inQuote) throw new TerminalTemplateError('Unclosed double quote in terminal command')
  if (current.length > 0) tokens.push(current)
  return tokens
}

function tokenizeWindowsTemplate(template: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let tokenStarted = false

  for (let index = 0; index < template.length; index += 1) {
    const ch = template[index]
    if (inQuote) {
      if (
        ch === '\\' && template[index + 1] === '"'
        && index + 2 < template.length && !/\s/.test(template[index + 2])
      ) {
        current += '"'
        tokenStarted = true
        index += 1
      } else if (ch === '"' && template[index + 1] === '"') {
        current += '"'
        tokenStarted = true
        index += 1
      } else if (ch === '"') {
        inQuote = false
        tokenStarted = true
      } else {
        current += ch
        tokenStarted = true
      }
      continue
    }

    if (ch === '"') {
      inQuote = true
      tokenStarted = true
    } else if (/\s/.test(ch)) {
      if (tokenStarted) {
        tokens.push(current)
        current = ''
        tokenStarted = false
      }
    } else if (
      ch === '\\' && index + 1 < template.length
      && (/\s/.test(template[index + 1]) || template[index + 1] === '"')
    ) {
      current += template[index + 1]
      tokenStarted = true
      index += 1
    } else {
      current += ch
      tokenStarted = true
    }
  }

  if (inQuote) throw new TerminalTemplateError('Unclosed double quote in terminal command')
  if (tokenStarted) tokens.push(current)
  return tokens
}

/** Parses and validates a terminal command template before substituting the cwd data. */
export function parseTerminalTemplate(
  raw: string,
  cwd: string,
  platform: DesktopPlatform = getDesktopPlatform(),
): { command: string; args: string[] } {
  if (!raw || !raw.trim()) throw new TerminalTemplateError('Terminal command is empty')
  if (raw.length > maxTemplateLength)
    throw new TerminalTemplateError(`Terminal command exceeds ${maxTemplateLength} characters`)
  if (raw.includes('\0'))
    throw new TerminalTemplateError('Terminal command contains invalid characters')

  const tokens = tokenizeTemplate(raw.trim(), platform)
  if (tokens.length === 0) throw new TerminalTemplateError('Terminal command produced no tokens')
  if (!raw.includes('{cwd}')) throw new TerminalTemplateError('Terminal command must contain {cwd}')

  const [command, ...args] = tokens.map((token) => token.replace(/\{cwd\}/g, cwd))
  if (!command) throw new TerminalTemplateError('Terminal command has no executable')
  return { command, args }
}

export interface TerminalInvocation {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  waitForExit?: boolean
  windowsHide?: boolean
}

/** Returns the first platform-specific default; Windows launch attempts may fall back further. */
export function defaultTerminalInvocation(
  workspacePath: string,
  platform = getDesktopPlatform(),
  env: NodeJS.ProcessEnv = process.env,
): TerminalInvocation {
  return defaultTerminalInvocations(workspacePath, platform, env)[0]
}

function defaultTerminalInvocations(
  workspacePath: string,
  platform: DesktopPlatform,
  env: NodeJS.ProcessEnv,
): TerminalInvocation[] {
  const wslDistribution = getWslDistributionName(env)
  if (platform === 'wsl') {
    return [{
      command: 'wt.exe',
      args: [
        'nt',
        '--',
        'wsl.exe',
        ...(wslDistribution ? ['-d', wslDistribution] : []),
        '--cd',
        workspacePath,
      ],
    }]
  }
  if (platform === 'linux')
    return [{ command: 'x-terminal-emulator', args: [], cwd: workspacePath }]
  return [
    { command: 'wt.exe', args: ['--window', 'new', '--startingDirectory', workspacePath] },
    { command: 'alacritty.exe', args: ['--working-directory', workspacePath] },
    { command: 'wezterm.exe', args: ['start', '--cwd', workspacePath] },
    windowsShellBroker('pwsh.exe', '-NoExit', workspacePath),
    windowsShellBroker('powershell.exe', '-NoExit', workspacePath),
    windowsShellBroker('cmd.exe', '/d', workspacePath),
  ]
}

function windowsShellBroker(shell: string, shellArgs: string, cwd: string): TerminalInvocation {
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:PI_LIVECRAFT_TERMINAL_SHELL -ArgumentList $env:PI_LIVECRAFT_TERMINAL_ARGS -WorkingDirectory $env:PI_LIVECRAFT_TERMINAL_CWD',
    ],
    env: {
      ...process.env,
      PI_LIVECRAFT_TERMINAL_ARGS: shellArgs,
      PI_LIVECRAFT_TERMINAL_SHELL: shell,
      PI_LIVECRAFT_TERMINAL_CWD: cwd,
    },
    waitForExit: true,
    windowsHide: true,
  }
}

/**
 * Launches a terminal detached from the backend. Only the empty default template
 * tries the next Windows candidate; a user template has exactly one invocation.
 */
export async function openTerminalApplication(
  workspacePath: string,
  template?: string | null,
  platform: DesktopPlatform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  if (template && template.trim()) {
    const invocation = parseTerminalTemplate(template, workspacePath, platform)
    await spawnDetached(invocation, spawnProcess)
    return
  }

  const candidates = defaultTerminalInvocations(workspacePath, platform, process.env)
  let lastError: unknown
  for (const invocation of candidates) {
    try {
      await spawnDetached(invocation, spawnProcess)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No terminal application is available')
}

function spawnDetached(invocation: TerminalInvocation, spawnProcess: SpawnProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      detached: !invocation.waitForExit,
      stdio: 'ignore',
      shell: false,
      windowsHide: invocation.windowsHide ?? false,
    })
    child.once('error', reject)
    if (invocation.waitForExit) {
      child.once('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${invocation.command} exited with code ${code ?? 'unknown'}`))
      })
      return
    }
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
