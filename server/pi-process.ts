import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonLineDecoder, encodeJsonLine } from './jsonl.ts'
import { resolvePiLauncher } from './pi-launcher.ts'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const activeChildren = new Set<ChildProcessWithoutNullStreams>()

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
    const launcher = resolvePiLauncher()
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
    this.child = spawn(launcher.command, [...launcher.argsPrefix, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
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

  /** Stops Pi gracefully before force-killing an unresponsive child. */
  async terminate(graceMs = 2_000): Promise<void> {
    await terminateChild(this.child, graceMs)
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

/** Terminates every tracked Pi child and waits for their bounded cleanup. */
export async function terminateAllPiProcesses(graceMs = 2_000): Promise<void> {
  await Promise.all([...activeChildren].map((child) => terminateChild(child, graceMs)))
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  if (process.platform === 'win32') child.stdin.end()
  else child.kill('SIGTERM')
  if (await settlesWithin(exited, graceMs)) return
  await forceKillChild(child)
  await settlesWithin(exited, Math.min(750, graceMs))
}

/** Force-kills a child, including its descendants through taskkill on Windows. */
export async function forceKillChild(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32' && child.pid && await taskkillProcessTree(child.pid)) return
  child.kill('SIGKILL')
}

function taskkillProcessTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const taskkill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        timeout: 750,
        windowsHide: true,
      })
      taskkill.once('error', () => resolve(false))
      taskkill.once('close', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])
}
