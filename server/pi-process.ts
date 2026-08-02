import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonLineDecoder, encodeJsonLine } from './jsonl.ts'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const activeChildren = new Set<ChildProcessWithoutNullStreams>()
const windowsPiScriptPattern =
  /\$basedir[\\/]([^"'`\r\n]*@earendil-works[\\/]pi-coding-agent[\\/][^"'`\r\n]+\.[cm]?js)/i

/** Resolves Pi's native executable or npm shim target without passing user arguments through a shell. */
function windowsPiInvocation(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  const pathValue = Object
    .entries(env)
    .find(([name]) => name.toLowerCase() === 'path')
    ?.[1]
  if (!pathValue) throw new Error('PATH is unavailable; cannot locate the Pi command')

  for (const value of pathValue.split(';')) {
    const directory = value.trim().replace(/^"(.*)"$/, '$1')
    if (!directory) continue

    const executable = join(directory, 'pi.exe')
    if (existsSync(executable)) return { command: executable, args: [...args] }

    try {
      const target = readFileSync(join(directory, 'pi.ps1'), 'utf8')
        .match(windowsPiScriptPattern)
        ?.[1]
      if (!target) continue
      const command = resolve(directory, target)
      if (existsSync(command)) return { command: process.execPath, args: [command, ...args] }
    } catch {
      // This PATH entry does not expose Pi through an npm PowerShell shim.
    }
  }

  throw new Error('Pi is not installed as a Windows executable or npm command shim on PATH')
}

/** Builds a shell-free Pi invocation so paths and prompts remain exact on every platform. */
export function piSpawnInvocation(
  args: readonly string[],
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (platform !== 'win32') return { command: 'pi', args: [...args], env }
  return { ...windowsPiInvocation(args, env), env }
}

/** Dedicated Pi profile directory for isolated prompts so model/thinking defaults never leak into the user's main config. */
export const ISOLATED_AGENT_DIR = join(homedir(), '.pi', 'livecraft-isolated')

interface PendingRequest {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface PiProcessOptions {
  isolated?: boolean
  systemPrompt?: string
  /** Thinking level for the isolated process (defaults to 'off'). */
  thinkingLevel?: string
  /** Extension paths to load (omitting passes --no-extensions). */
  extensions?: string[]
  /** Tool names to load (omitting passes --no-tools). */
  tools?: string[]
  /** Whether Pi loads AGENTS.md/CLAUDE.md from parent directories (default true). */
  includeContextFiles?: boolean
}

export class PiProcess extends EventEmitter {
  readonly child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<string, PendingRequest>()
  #stderr = ''

  /** Starts Pi in RPC mode and connects its JSONL stream to this instance's lifecycle. */
  constructor(
    cwd: string,
    sessionId: string,
    sessionPath?: string,
    options: PiProcessOptions = {},
  ) {
    super()
    const args = options.isolated
      ? [
        '--mode',
        'rpc',
        '--no-session',
        ...(options.tools ? options.tools.flatMap((name) => ['--tool', name]) : ['--no-tools']),
        ...(options.extensions
          ? options.extensions.flatMap((path) => ['--extension', path])
          : ['--no-extensions']),
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        ...(options.includeContextFiles === false ? ['--no-context-files'] : []),
        '--thinking',
        options.thinkingLevel ?? 'off',
        '--system-prompt',
        options.systemPrompt ?? '',
      ]
      : [
        '--mode',
        'rpc',
        '--extension',
        fileURLToPath(new URL('../pi-extensions/ask-user-question.ts', import.meta.url)),
        '--extension',
        fileURLToPath(new URL('../pi-extensions/quotas.ts', import.meta.url)),
        ...(sessionPath ? ['--session', sessionPath] : ['--session-id', sessionId]),
      ]

    const env = options.isolated
      ? { ...process.env, PI_CODING_AGENT_DIR: ISOLATED_AGENT_DIR }
      : process.env
    const invocation = piSpawnInvocation(args, process.platform, env)
    this.child = spawn(invocation.command, invocation.args, {
      cwd,
      env: invocation.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    activeChildren.add(this.child)

    const decoder = new JsonLineDecoder((value) => this.#receive(value))
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk)
      } catch (error) {
        this.#fail(error)
      }
    })
    this.child.stdout.on('end', () => decoder.end())
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-8_192)
    })
    this.child.on('error', (error) => {
      activeChildren.delete(this.child)
      this.#fail(error)
    })
    this.child.on('exit', (code, signal) => {
      activeChildren.delete(this.child)
      const detail = this.#stderr.trim()
      this.#fail(
        new Error(`Pi exited (${signal ?? code ?? 'unknown'})${detail ? `: ${detail}` : ''}`),
      )
      this.emit('exit', { code, signal, detail })
    })
  }

  /** Associates a command with an RPC response and rejects the promise if Pi takes too long. */
  request(
    command: JsonObject,
    timeoutMs = (command.type === 'prompt' || command.type === 'compact') ? 10 * 60_000 : 30_000,
  ): Promise<JsonObject> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Pi RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timeout })
      this.send({ ...command, id })
    })
  }

  send(command: JsonObject): void {
    if (!this.child.stdin.writable) throw new Error('Pi RPC input is closed')
    this.child.stdin.write(encodeJsonLine(command))
  }

  terminate(): void {
    terminatePiChild(this.child)
  }

  /** Distinguishes expected responses from asynchronous events emitted by Pi. */
  #receive(value: unknown): void {
    if (!isObject(value)) return
    if (value.type === 'response' && typeof value.id === 'string') {
      const pending = this.#pending.get(value.id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.#pending.delete(value.id)
        if (value.success === false)
          pending.reject(new Error(String(value.error ?? 'Pi RPC command failed')))
        else pending.resolve(value)
        return
      }
    }
    this.emit('event', value)
  }

  /** Rejects all pending commands when an error makes the process unusable. */
  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

/** Requests Pi shutdown and force-kills its Windows process tree if EOF is ignored. */
export function terminatePiChild(
  child: ChildProcessWithoutNullStreams,
  platform = process.platform,
  graceMs = 2_000,
): void {
  if (platform !== 'win32') {
    child.kill('SIGTERM')
    return
  }

  if (child.stdin.writable) child.stdin.end()
  const timeout = setTimeout(() => {
    if (child.exitCode === null) void forceKillWindowsProcessTree(child)
  }, graceMs)
  timeout.unref()
  child.once('exit', () => clearTimeout(timeout))
}

/** Terminates every Pi child owned by this process and force-kills stragglers after the grace period. */
export async function terminateAllPiProcesses(graceMs = 2_000): Promise<void> {
  const children = [...activeChildren]
  if (children.length === 0) return
  const exited = Promise.all(
    children.map((child) => new Promise<void>((resolve) => child.once('exit', () => resolve()))),
  )
  for (const child of children) {
    if (process.platform === 'win32') {
      if (child.stdin.writable) child.stdin.end()
    } else child.kill('SIGTERM')
  }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, graceMs))])
  if (process.platform === 'win32')
    await Promise.all([...activeChildren].map(forceKillWindowsProcessTree))
  else for (const child of activeChildren) child.kill('SIGKILL')
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, Math.min(750, graceMs))),
  ])
}

/** Kills a Windows process and every descendant because Windows has no POSIX signal tree. */
export function forceKillWindowsProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    })
    killer.once('error', () => {
      child.kill('SIGKILL')
      resolve()
    })
    killer.once('exit', (code) => {
      if (code !== 0) child.kill('SIGKILL')
      resolve()
    })
  })
}
