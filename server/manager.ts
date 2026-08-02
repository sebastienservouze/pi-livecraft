/**
 * Single owner of all `pi --mode rpc` processes.
 *
 * Invariant: a guarded restart closes owned Pi processes, while persisted
 * sessions remain reopenable from history. The backend communicates through
 * ManagerClient; never spawn Pi directly or bypass the supervised lifecycle.
 */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { JsonLineDecoder, encodeJsonLine } from './jsonl.ts'
import { PiProcess, terminateAllPiProcesses } from './pi-process.ts'
import {
  generateProjectMap,
  improvementDirectionInstruction,
  loadPromptImprovementSystemPrompt,
} from './prompt-improvement.ts'
import { runIsolatedPrompt } from './run-isolated-prompt.ts'
import { isObject } from '../shared/is-object.ts'
import type {
  JsonObject,
  ManagerEvent,
  ManagerRequest,
  ManagerResponse,
  SessionSummary,
} from '../shared/types.ts'

const host = '127.0.0.1'
const port = readPort('PI_LIVECRAFT_MANAGER_PORT', 43_120)
const clients = new Set<Socket>()
const sessions = new Map<string, ManagedSession>()
const restartExitCode = readRestartExitCode()
const supervised = process.env.PI_LIVECRAFT_MANAGER_SUPERVISED === '1'
  && restartExitCode !== undefined
const runtimeIdentity = {
  instanceId: randomUUID(),
  startedAt: new Date().toISOString(),
  runtimeRevision: process.env.PI_LIVECRAFT_MANAGER_RUNTIME_REVISION ?? null,
  supervised,
}
let shuttingDown = false
let restartAccepted = false
let activeRequests = 0

interface ManagedSession {
  summary: SessionSummary
  pi: PiProcess
  pendingUi: Map<string, JsonObject>
}

const server = createServer((socket) => {
  clients.add(socket)
  socket.setNoDelay(true)
  const decoder = new JsonLineDecoder((value) => void handleRequest(socket, value))
  socket.on('data', (chunk) => {
    try {
      decoder.push(chunk)
    } catch (error) {
      respond(socket, { kind: 'response', id: '', ok: false, error: errorMessage(error) })
      socket.destroy()
    }
  })
  socket.on('end', () => decoder.end())
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => clients.delete(socket))
})

server.on('error', (error) => {
  console.error(`Pi manager failed: ${error.message}`)
  void shutdown(1)
})

server.listen(port, host, () => {
  console.log(`Pi manager listening on tcp://${host}:${port}`)
})

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

/** Closes manager connections and every owned Pi process before exiting. */
async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  const serverClosed = server.listening
    ? new Promise<void>((resolve) => server.close(() => resolve()))
    : Promise.resolve()
  for (const client of clients) client.end()
  await Promise.race([
    Promise.all([serverClosed, terminateAllPiProcesses()]),
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ])
  for (const client of clients) client.destroy()
  process.exit(exitCode)
}

async function handleRequest(socket: Socket, value: unknown): Promise<void> {
  if (!isManagerRequest(value)) {
    respond(socket, { kind: 'response', id: '', ok: false, error: 'Invalid manager request' })
    return
  }
  if (restartAccepted) {
    respond(socket, {
      kind: 'response',
      id: value.id,
      ok: false,
      error: 'Pi manager restart is already in progress',
    })
    return
  }

  const tracksActivity = value.action === 'create' || value.action === 'open' || value
        .action === 'command'
    || value.action === 'improve_prompt' || value.action === 'run_prompt'
  if (tracksActivity) activeRequests += 1
  try {
    let data: unknown
    if (value.action === 'status') data = runtimeIdentity
    else if (value.action === 'restart') {
      if (!supervised || restartExitCode === undefined)
        throw new Error('Pi manager is not supervised')
      if (activeRequests > 0) throw new Error('Active Pi work must settle before restarting')
      const activePiWork = await refreshSessionActivity()
      const activityStartedDuringCheck = activeRequests > 0
        || [...sessions.values()].some(({ summary }) =>
          summary.status === 'starting' || summary.status === 'running'
        )
      if (activePiWork || activityStartedDuringCheck)
        throw new Error('Active Pi work must settle before restarting')
      restartAccepted = true
      respond(socket, { kind: 'response', id: value.id, ok: true, data: { accepted: true } })
      setImmediate(() => void shutdown(restartExitCode))
      return
    } else if (value.action === 'list') {
      await refreshSessionActivity()
      data = listSessions()
    } else if (value.action === 'create') data = await createSession(value)
    else if (value.action === 'open') data = await openSession(value)
    else if (value.action === 'improve_prompt') data = await improvePrompt(value)
    else if (value.action === 'run_prompt') data = await runPrompt(value)
    else data = await sendCommand(value)
    respond(socket, { kind: 'response', id: value.id, ok: true, data })
  } catch (error) {
    respond(socket, { kind: 'response', id: value.id, ok: false, error: errorMessage(error) })
  } finally {
    if (tracksActivity) activeRequests -= 1
  }
}

function listSessions(): SessionSummary[] {
  return [...sessions.values()].map(({ summary, pendingUi }) => ({
    ...summary,
    pendingUi: [...pendingUi.values()],
  }))
}

/** Reconciles cached session activity with Pi's live state before reporting or acting on it. */
async function refreshSessionActivity(): Promise<boolean> {
  const managedSessions = [...sessions.values()].filter(({ summary }) =>
    summary.status !== 'exited'
  )
  const activity = await Promise.all(managedSessions.map(async (session) => {
    const state = await session.pi.request({ type: 'get_state' }, 5_000)
    if (
      !isObject(state.data)
      || typeof state.data.isStreaming !== 'boolean'
      || typeof state.data.isCompacting !== 'boolean'
      || typeof state.data.pendingMessageCount !== 'number'
      || !Number.isInteger(state.data.pendingMessageCount)
      || state.data.pendingMessageCount < 0
    ) throw new Error('Pi returned an invalid session state')
    const running = state.data.isStreaming || state.data.isCompacting
      || state.data.pendingMessageCount > 0
    session.summary.status = running ? 'running' : 'idle'
    return running || session.pendingUi.size > 0
  }))
  return activity.some(Boolean)
}

async function createSession(request: ManagerRequest): Promise<SessionSummary> {
  if (typeof request.cwd !== 'string') throw new Error('Session cwd is required')
  const cwd = await realpath(request.cwd)
  if (!(await stat(cwd)).isDirectory()) throw new Error('Session cwd must be a directory')

  const summary: SessionSummary = {
    id: randomUUID(),
    cwd,
    name: 'Nouvelle session',
    status: 'starting',
    pendingUi: [],
  }

  await startSession(summary)
  broadcast({ kind: 'event', event: 'session_created', sessionId: summary.id, data: summary })
  return { ...summary, pendingUi: [] }
}

async function openSession(request: ManagerRequest): Promise<SessionSummary> {
  if (
    typeof request.cwd !== 'string' || typeof request.name !== 'string'
    || typeof request.sessionPath !== 'string'
  ) {
    throw new Error('Session cwd, name and path are required')
  }
  const existing = [...sessions.values()].find(({ summary }) =>
    summary.sessionPath === request.sessionPath
  )
  if (existing && existing.summary.status !== 'exited')
    return {
      ...existing.summary,
      pendingUi: [...existing.pendingUi.values()],
    }
  if (existing) sessions.delete(existing.summary.id)

  const summary: SessionSummary = {
    id: randomUUID(),
    cwd: request.cwd,
    name: request.name,
    sessionPath: request.sessionPath,
    status: 'starting',
    pendingUi: [],
  }
  await startSession(summary)
  broadcast({ kind: 'event', event: 'session_created', sessionId: summary.id, data: summary })
  return { ...summary, pendingUi: [] }
}

/** Records a session as soon as Pi starts so its early events can be queried without a race condition. */
async function startSession(summary: SessionSummary): Promise<void> {
  const pi = new PiProcess(summary.cwd, summary.id, summary.sessionPath)
  const session: ManagedSession = { summary, pi, pendingUi: new Map() }

  sessions.set(summary.id, session)
  pi.on('event', (event: JsonObject) => handlePiEvent(summary.id, session, event))
  pi.on('exit', (detail: unknown) => {
    summary.status = 'exited'
    broadcast({ kind: 'event', event: 'session_exited', sessionId: summary.id, data: detail })
  })

  try {
    const state = await pi.request({ type: 'get_state' })
    const sessionPath = isObject(state.data) && typeof state.data.sessionFile === 'string'
      ? state.data.sessionFile
      : undefined
    if (sessionPath) summary.sessionPath = sessionPath
    summary.status = 'idle'
  } catch (error) {
    sessions.delete(summary.id)
    await pi.terminate()
    throw error
  }
}

/** Rewrites a draft in a disposable, tool-free Pi process without touching the active session. */
async function improvePrompt(request: ManagerRequest): Promise<{ prompt: string; cost?: number }> {
  if (
    typeof request.sessionId !== 'string' || typeof request.prompt !== 'string' || !request
      .prompt
      .trim()
    || request.prompt.length > 100_000
  ) {
    throw new Error('Session id and a prompt between 1 and 100,000 characters are required')
  }
  const session = sessions.get(request.sessionId)
  if (!session || session.summary.status === 'exited')
    throw new Error('Active Pi session is unavailable')

  const direction = typeof request.direction === 'string'
    ? improvementDirectionInstruction(request.direction)
    : undefined
  const [systemPrompt, projectMap] = await Promise.all([
    loadPromptImprovementSystemPrompt(),
    generateProjectMap(session.summary.cwd),
  ])
  const directionBlock = direction
    ? `<improvement_direction>${direction}</improvement_direction>\n\n`
    : ''
  const result = await runIsolatedPrompt({
    cwd: session.summary.cwd,
    prompt: `<user_prompt>\n${request.prompt.trim()}\n</user_prompt>`,
    systemPrompt: `${systemPrompt}\n\n${directionBlock}${projectMap}`,
    includeContextFiles: false,
  })
  return { prompt: result.text, cost: result.cost }
}

/** Runs a prompt in an isolated, disposable Pi process with caller-controlled configuration. */
async function runPrompt(request: ManagerRequest): Promise<{ text: string }> {
  if (
    typeof request.sessionId !== 'string' || typeof request.prompt !== 'string' || !request
      .prompt
      .trim()
    || request.prompt.length > 100_000
  ) {
    throw new Error('Session id and a prompt between 1 and 100,000 characters are required')
  }
  const session = sessions.get(request.sessionId)
  if (!session || session.summary.status === 'exited')
    throw new Error('Active Pi session is unavailable')

  const result = await runIsolatedPrompt({
    cwd: session.summary.cwd,
    prompt: request.prompt.trim(),
    systemPrompt: typeof request.systemPrompt === 'string' ? request.systemPrompt : undefined,
    thinkingLevel: typeof request.thinkingLevel === 'string' ? request.thinkingLevel : undefined,
    model: isModelOption(request.model) ? request.model : undefined,
    extensions: Array.isArray(request.extensions)
      ? request.extensions.filter((e): e is string => typeof e === 'string')
      : undefined,
    tools: Array.isArray(request.tools)
      ? request.tools.filter((t): t is string => typeof t === 'string')
      : undefined,
    includeContextFiles: typeof request.includeContextFiles === 'boolean'
      ? request.includeContextFiles
      : undefined,
  })
  return { text: result.text }
}

function isModelOption(value: unknown): value is { provider: string; modelId: string } {
  return isObject(value) && typeof value.provider === 'string' && typeof value.modelId === 'string'
}

/** Forwards one RPC command while making prompt activity visible before Pi emits its first event. */
async function sendCommand(request: ManagerRequest): Promise<JsonObject> {
  if (typeof request.sessionId !== 'string' || !isObject(request.command)) {
    throw new Error('Session id and Pi command are required')
  }
  const session = sessions.get(request.sessionId)
  if (!session) throw new Error('Unknown session')
  if (session.summary.status === 'exited') throw new Error('Pi session has exited')

  if (request.command.type === 'extension_ui_response') {
    if (typeof request.command.id === 'string') session.pendingUi.delete(request.command.id)
    session.pi.send(request.command)
    return { success: true }
  }

  const startsAgent = request.command.type === 'prompt'
    && (typeof request.command.message !== 'string' || !request.command.message.startsWith('/'))
  if (startsAgent) session.summary.status = 'running'
  try {
    return await session.pi.request(request.command)
  } catch (error) {
    if (startsAgent && session.summary.status === 'running') session.summary.status = 'idle'
    throw error
  }
}

function handlePiEvent(sessionId: string, session: ManagedSession, event: JsonObject): void {
  if (event.type === 'session_info_changed') {
    session.summary.name = typeof event.name === 'string' && event.name.trim()
      ? event.name.trim()
      : 'Nouvelle session'
  }
  if (event.type === 'agent_start') session.summary.status = 'running'
  if (event.type === 'agent_settled') session.summary.status = 'idle'
  if (
    event.type === 'extension_ui_request' && event.method === 'setStatus'
    && event.statusKey === 'agent'
  ) {
    session.summary.activeAgent = activeAgentFromStatus(event.statusText)
    event.activeAgent = session.summary.activeAgent
  }
  if (
    event.type === 'extension_ui_request' && isBlockingUiRequest(event)
    && typeof event.id === 'string'
  ) {
    session.pendingUi.set(event.id, event)
  }
  broadcast({ kind: 'event', event: 'pi', sessionId, data: event })
}

function activeAgentFromStatus(statusText: unknown): string | undefined {
  if (typeof statusText !== 'string') return undefined
  const prefix = 'Agent:'
  const prefixIndex = statusText.indexOf(prefix)
  if (prefixIndex === -1) return undefined
  const rawName = statusText.slice(prefixIndex + prefix.length)
  const endIndex = rawName.indexOf('\u001b')
  const name = rawName.slice(0, endIndex === -1 ? undefined : endIndex).trim()
  return name || undefined
}

function isBlockingUiRequest(event: JsonObject): boolean {
  return event.method === 'select' || event.method === 'confirm' || event.method === 'input'
    || event.method === 'editor'
}

function broadcast(event: ManagerEvent): void {
  const line = encodeJsonLine(event)
  for (const client of clients) {
    if (client.writable) client.write(line)
  }
}

function respond(socket: Socket, response: ManagerResponse): void {
  if (socket.writable) socket.write(encodeJsonLine(response))
}

function isManagerRequest(value: unknown): value is ManagerRequest {
  if (!isObject(value) || typeof value.id !== 'string') return false
  return value.action === 'list' || value.action === 'create' || value.action === 'open' || value
        .action === 'command'
    || value.action === 'improve_prompt' || value.action === 'run_prompt'
    || value.action === 'status' || value.action === 'restart'
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads and validates a port from the environment, using the supplied default when unset. */
function readPort(primary: string, fallback: number): number {
  const value = Number(process.env[primary] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new Error(`${primary} must be a valid port`)
  return value
}

function readRestartExitCode(): number | undefined {
  const rawValue = process.env.PI_LIVECRAFT_MANAGER_RESTART_EXIT_CODE
  if (rawValue === undefined) return undefined
  const value = Number(rawValue)
  return Number.isInteger(value) && value > 0 && value <= 255 ? value : undefined
}
