import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ShellOutputChunk, ShellSessionInfo } from '../../../shared/types.ts'

/** Replayed to a reconnecting panel, so it stays small enough to send in one event. */
const maxReplayedOutput = 128 * 1024
const idleTimeoutMs = 60 * 60 * 1000
const maxSessions = 8

export class ShellSessionError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface ShellSession {
  readonly id: string
  readonly cwd: string
  readonly shell: string
  child: ChildProcess
  replay: string
  exited: boolean
  usedFallback: boolean
  startedAt: number
  idleTimer: NodeJS.Timeout
  readonly listeners: Set<(chunk: ShellOutputChunk) => void>
}

/** A pty wrapper that dies this fast never gave the user a shell, so a retry is safe. */
const ptyProbeMs = 3000

const sessions = new Map<string, ShellSession>()

/**
 * Builds the command that gives the shell a pseudo terminal.
 *
 * `script` is used instead of a native pty binding so the browser terminal works
 * on every host the backend already runs on, without a compiled dependency.
 */
export function shellLaunch(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  withPty = true,
): { command: string; args: string[]; shell: string } {
  const shell = env.SHELL || (platform === 'win32' ? 'powershell.exe' : '/bin/bash')
  if (platform === 'win32') return { command: shell, args: [], shell }
  if (!withPty) return { command: shell, args: ['-i'], shell }
  return platform === 'darwin'
    ? { command: 'script', args: ['-q', '/dev/null', shell, '-i'], shell }
    : { command: 'script', args: ['-q', '-f', '-e', '-c', `${shell} -i`, '/dev/null'], shell }
}

/** Starts a shell attached to the working directory and streams its output to subscribers. */
export function createShellSession(cwd: string): ShellSessionInfo {
  if (sessions.size >= maxSessions)
    throw new ShellSessionError('Too many terminal sessions are open', 429)

  const { command, args, shell } = shellLaunch()
  const session: ShellSession = {
    id: randomUUID(),
    cwd,
    shell,
    child: spawnShell(command, args, cwd),
    replay: '',
    exited: false,
    usedFallback: false,
    startedAt: Date.now(),
    idleTimer: setTimeout(() => closeShellSession(session.id), idleTimeoutMs),
    listeners: new Set(),
  }
  session.idleTimer.unref?.()
  sessions.set(session.id, session)
  attach(session)
  return { id: session.id, cwd: session.cwd, shell: session.shell }
}

/** Sends keystrokes to the shell; control characters reach it through the pty unchanged. */
export function writeShellInput(id: string, data: string): void {
  const session = requireSession(id)
  if (session.exited) throw new ShellSessionError('Terminal session has exited', 409)
  session.child.stdin?.write(data)
  touch(session)
}

/**
 * Streams shell output to one subscriber, starting with the buffered scrollback so a
 * reopened panel shows the session as it already is.
 */
export function subscribeShellOutput(
  id: string,
  listener: (chunk: ShellOutputChunk) => void,
): () => void {
  const session = requireSession(id)
  session.listeners.add(listener)
  if (session.replay) listener({ chunk: session.replay })
  if (session.exited) listener({ chunk: '', exited: true })
  touch(session)
  return () => {
    session.listeners.delete(listener)
  }
}

/** Terminates the shell and forgets the session. */
export function closeShellSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  clearTimeout(session.idleTimer)
  sessions.delete(id)
  session.listeners.clear()
  if (session.exited) return

  // An interactive shell ignores SIGTERM, so close its input and hang it up first.
  const { child } = session
  child.stdin?.end()
  child.kill('SIGHUP')
  const force = setTimeout(() => child.kill('SIGKILL'), 2000)
  force.unref?.()
  child.once('exit', () => clearTimeout(force))
}

export function shellSessionExists(id: string): boolean {
  return sessions.has(id)
}

export function closeAllShellSessions(): void {
  for (const id of [...sessions.keys()]) closeShellSession(id)
}

function requireSession(id: string): ShellSession {
  const session = sessions.get(id)
  if (!session) throw new ShellSessionError('Unknown terminal session', 404)
  return session
}

function spawnShell(command: string, args: string[], cwd: string): ChildProcess {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '120', LINES: '30' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function attach(session: ShellSession): void {
  const { child } = session
  // Writing to a shell that just died must not take the backend down with it.
  child.stdin?.on('error', () => {})
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => emit(session, chunk))
  child.stderr?.on('data', (chunk: string) => emit(session, chunk))
  child.on('error', (error) => {
    if (restartWithoutPty(session)) return
    emit(session, `\r\n[terminal failed: ${error.message}]\r\n`)
    finish(session)
  })
  child.on('exit', (code, signal) => {
    if (session.child !== child) return
    // A pty wrapper that is missing, or refuses a piped stdin, fails immediately.
    const failedToStart = code !== 0 && Date.now() - session.startedAt < ptyProbeMs
    if (failedToStart && restartWithoutPty(session)) return
    emit(session, `\r\n[shell exited: ${signal ?? code ?? 0}]\r\n`)
    finish(session)
  })
}

/**
 * Retries once with a plain shell when the pseudo terminal is unavailable.
 * The failed attempt is cleared from the view so its diagnostics do not look like output.
 */
function restartWithoutPty(session: ShellSession): boolean {
  if (session.usedFallback) return false
  session.usedFallback = true
  session.replay = ''
  for (const listener of session.listeners) listener({ chunk: '\u001b[2J' })
  const { command, args } = shellLaunch(process.platform, process.env, false)
  session.startedAt = Date.now()
  session.child = spawnShell(command, args, session.cwd)
  attach(session)
  return true
}

function emit(session: ShellSession, chunk: string): void {
  session.replay = (session.replay + chunk).slice(-maxReplayedOutput)
  for (const listener of session.listeners) listener({ chunk })
  touch(session)
}

function finish(session: ShellSession): void {
  session.exited = true
  for (const listener of session.listeners) listener({ chunk: '', exited: true })
}

function touch(session: ShellSession): void {
  clearTimeout(session.idleTimer)
  session.idleTimer = setTimeout(() => closeShellSession(session.id), idleTimeoutMs)
  session.idleTimer.unref?.()
}
