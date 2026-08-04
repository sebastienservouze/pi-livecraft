import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { ManagerClient } from './manager-client.ts'
import { ManagerRuntimeMonitor } from './manager-runtime-monitor.ts'
import { listRecentPiSessions, loadPiSession } from './pi-session-store.ts'
import { discoverCapabilities } from './capabilities.ts'
import {
  commitChanges,
  discardChanges,
  discardFileChanges,
  getGitFileDiff,
  getGitSnapshot,
  pushCommits,
  resetGitCommit,
  revertGitCommit,
} from './features/git/git.ts'
import { QuotaService } from './features/quotas/quota-service.ts'
import { openTerminalApplication, TerminalTemplateError } from './features/terminal/launcher.ts'
import {
  loadWorkspaceTodos,
  parseTodoItems,
  saveWorkspaceTodos,
} from './features/todos/todo-store.ts'
import {
  readWorkspaceFile,
  resolveWorkspaceFilePath,
  WorkspaceFileError,
} from './workspace-file.ts'
import { activeSessionMessages, LiveSessionEvents } from './session-snapshot.ts'
import { loadPromptTemplates, savePromptTemplate } from './prompt-templates.ts'
import { externalWorkspacePath, openPath } from './system-integration.ts'
import { expandHomePath } from './home-path.ts'
import type {
  DirectoryListing,
  JsonObject,
  ManagerEvent,
  SessionSnapshot,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const host = '127.0.0.1'
const port = readPort('PI_LIVECRAFT_BACKEND_PORT', 43_121)
const managerPort = readPort('PI_LIVECRAFT_MANAGER_PORT', 43_120)
const manager = new ManagerClient(host, managerPort)
const eventClients = new Set<ServerResponse>()
const liveSessionEvents = new Map<string, LiveSessionEvents>()
let piEventSequence = 0
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
const quotas = new QuotaService(manager)
const managerRuntime = new ManagerRuntimeMonitor(manager, (status) => {
  broadcast({ kind: 'event', event: 'manager_status', sessionId: '', data: status })
})

manager.on('event', (event: ManagerEvent) => {
  quotas.receiveManagerEvent(event)
  if (event.event === 'session_exited') liveSessionEvents.delete(event.sessionId)
  if (event.event === 'pi' && isObject(event.data)) {
    const sequence = ++piEventSequence
    const live = liveSessionEvents.get(event.sessionId) ?? new LiveSessionEvents()
    liveSessionEvents.set(event.sessionId, live)
    live.receive(event.data, sequence)
    broadcast({ ...event, sequence })
    return
  }
  broadcast(event)
})
manager.on('connected', () => {
  managerRuntime.connected()
  broadcast({ kind: 'event', event: 'manager_connected', sessionId: '' })
  void quotas.restoreFromIdleSession()
})
manager.on('disconnected', () => {
  managerRuntime.disconnected()
  broadcast({ kind: 'event', event: 'manager_disconnected', sessionId: '' })
})
managerRuntime.start()
manager.start()

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500
    if (!response.headersSent) sendJson(response, status, { error: errorMessage(error) })
    else response.end()
  })
})

server.listen(port, host, () => {
  console.log(`Pi backend listening on http://${host}:${port}`)
})

/** Centralizes HTTP routing so validation and responses remain consistent across endpoints. */
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${host}`)

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, manager.connected ? 200 : 503, {
      ok: true,
      managerConnected: manager.connected,
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(
      `retry: 500\n\ndata: ${
        JSON.stringify({
          kind: 'event',
          event: manager.connected
            ? 'manager_connected'
            : 'manager_disconnected',
          sessionId: '',
        })
      }\n\n`,
    )
    response.write(
      `data: ${
        JSON.stringify({
          kind: 'event',
          event: 'manager_status',
          sessionId: '',
          data: managerRuntime.status,
        })
      }\n\n`,
    )
    eventClients.add(response)
    request.on('close', () => eventClients.delete(response))
    return
  }

  if (method === 'POST' && url.pathname === '/api/manager/restart') {
    await readJsonBody(request)
    try {
      await managerRuntime.restart()
    } catch (error) {
      throw new HttpError(manager.connected ? 409 : 503, errorMessage(error))
    }
    sendJson(response, 202, { accepted: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/sessions') {
    sendJson(response, 200, await manager.request({ action: 'list' }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/quotas') {
    sendJson(response, 200, await quotas.snapshot())
    return
  }

  if (method === 'POST' && url.pathname === '/api/quotas/refresh') {
    const body = await readJsonBody(request)
    if (typeof body.sessionId !== 'string' || !body.sessionId)
      throw new HttpError(409, 'An open Pi session is required to refresh quotas.')
    sendJson(response, 200, await quotas.refresh(body.sessionId, body.automatic === true))
    return
  }

  if (method === 'GET' && url.pathname === '/api/sessions/recent') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await listRecentPiSessions(cwd))
    return
  }

  if (method === 'GET' && url.pathname === '/api/capabilities') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await discoverCapabilities(cwd))
    return
  }

  if (method === 'GET' && url.pathname === '/api/directories') {
    sendJson(response, 200, await listDirectories(url.searchParams.get('path') ?? '~/.pi'))
    return
  }

  if (method === 'POST' && url.pathname === '/api/explorer') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    await openPath(await resolveWorkingDirectory(body.cwd))
    sendJson(response, 200, {})
    return
  }

  if (method === 'GET' && url.pathname === '/api/git') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await getGitSnapshot(cwd))
    return
  }

  if (method === 'GET' && url.pathname === '/api/git/diff') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    const path = url.searchParams.get('path')
    if (!path) throw new HttpError(400, 'File path is required')
    sendJson(
      response,
      200,
      await getGitFileDiff(cwd, path, url.searchParams.get('commit') ?? undefined),
    )
    return
  }

  if (method === 'GET' && (url.pathname === '/api/files' || url.pathname === '/api/files/path')) {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    const path = url.searchParams.get('path')
    if (!path) throw new HttpError(400, 'File path is required')
    try {
      const file = await readWorkspaceFile(cwd, path)
      sendJson(
        response,
        200,
        url.pathname === '/api/files'
          ? file
          : { absolutePath: file.path, path: await externalWorkspacePath(file.path) },
      )
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new HttpError(error.status, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/files/open') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    if (typeof body.path !== 'string' || !body.path)
      throw new HttpError(400, 'File path is required')
    try {
      const cwd = await resolveWorkingDirectory(body.cwd)
      await openPath(await resolveWorkspaceFilePath(cwd, body.path))
      sendJson(response, 200, {})
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new HttpError(error.status, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && url.pathname === '/api/todos') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await loadWorkspaceTodos(cwd))
    return
  }

  if (method === 'PUT' && url.pathname === '/api/todos') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    let todos
    try {
      todos = parseTodoItems(body.todos)
    } catch (error) {
      throw new HttpError(400, errorMessage(error))
    }
    await saveWorkspaceTodos(cwd, todos)
    sendJson(response, 200, todos)
    return
  }

  if (method === 'POST' && url.pathname === '/api/terminal') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const template = typeof body.template === 'string' && body.template.trim()
      ? body.template
      : undefined
    if (template !== undefined && template.length > 2000)
      throw new HttpError(400, 'Terminal command template is too long')
    try {
      await openTerminalApplication(await resolveWorkingDirectory(body.cwd), template)
      sendJson(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof TerminalTemplateError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/commit') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    const message = typeof body.message === 'string' ? body.message : ''
    await commitChanges(cwd, message)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/push') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await pushCommits(cwd))
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/discard') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    if (typeof body.path === 'string') await discardFileChanges(cwd, body.path)
    else await discardChanges(cwd)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/reset') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string' || typeof body.hash !== 'string')
      throw new HttpError(400, 'Working directory and commit hash are required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await resetGitCommit(cwd, body.hash))
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/revert') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string' || typeof body.hash !== 'string')
      throw new HttpError(400, 'Working directory and commit hash are required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await revertGitCommit(cwd, body.hash))
    return
  }

  if (method === 'POST' && url.pathname === '/api/prompts') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    if (body.scope !== 'project' && body.scope !== 'global')
      throw new HttpError(400, 'Prompt scope must be project or global')
    if (typeof body.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(body.name))
      throw new HttpError(
        400,
        'Prompt name must use 1–80 letters, numbers, hyphens, or underscores',
      )
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100_000)
      throw new HttpError(400, 'Prompt content must contain between 1 and 100,000 characters')
    try {
      const cwd = await resolveWorkingDirectory(body.cwd)
      sendJson(response, 201, await savePromptTemplate(cwd, body.scope, body.name, body.content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new HttpError(409, `Prompt “${body.name}” already exists in this location`)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJsonBody(request)
    const cwd = await resolveWorkingDirectory(typeof body.cwd === 'string' ? body.cwd : '~/.pi')
    if (typeof body.sessionPath === 'string') {
      const session = await loadPiSession(body.sessionPath)
      if (session.cwd !== cwd)
        throw new HttpError(400, 'Pi session does not belong to this working directory')
      sendJson(
        response,
        201,
        await manager.request({
          action: 'open',
          cwd,
          name: session.name,
          sessionPath: session.sessionPath,
        }),
      )
      return
    }
    const session = await manager.request({ action: 'create', cwd })
    sendJson(response, 201, session)
    return
  }

  const snapshotMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshot$/)
  if (method === 'GET' && snapshotMatch) {
    const sessionId = decodeURIComponent(snapshotMatch[1])
    const [state, entries, models, commands, stats] = await Promise.all([
      piCommand(sessionId, { type: 'get_state' }),
      piCommand(sessionId, { type: 'get_entries' }),
      piCommand(sessionId, { type: 'get_available_models' }),
      piCommand(sessionId, { type: 'get_commands' }),
      piCommand(sessionId, { type: 'get_session_stats' }),
    ])
    const commandList = arrayData(commands, 'commands')
    const snapshot: SessionSnapshot = {
      state: objectData(state),
      messages: activeSessionMessages(arrayData(entries, 'entries'), objectData(entries)?.leafId),
      models: arrayData(models, 'models'),
      commands: commandList,
      promptTemplates: await loadPromptTemplates(commandList),
      stats: objectData(stats),
      liveEvents: liveSessionEvents.get(sessionId)?.snapshot() ?? [],
    }
    sendJson(response, 200, snapshot)
    return
  }

  const promptImprovementMatch = url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/prompt-improvement$/,
  )
  if (method === 'POST' && promptImprovementMatch) {
    const body = await readJsonBody(request)
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) {
      throw new HttpError(400, 'A prompt between 1 and 100,000 characters is required')
    }
    if (body.direction !== undefined && typeof body.direction !== 'string') {
      throw new HttpError(400, 'Direction must be a string when provided')
    }
    const data = await manager.request({
      action: 'improve_prompt',
      sessionId: decodeURIComponent(promptImprovementMatch[1]),
      prompt: body.prompt,
      direction: body.direction,
    }, 3 * 60_000)
    sendJson(response, 200, data)
    return
  }

  const runPromptMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/run-prompt$/)
  if (method === 'POST' && runPromptMatch) {
    const body = await readJsonBody(request)
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) {
      throw new HttpError(400, 'A prompt between 1 and 100,000 characters is required')
    }
    const data = await manager.request({
      action: 'run_prompt',
      sessionId: decodeURIComponent(runPromptMatch[1]),
      prompt: body.prompt,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      thinkingLevel: typeof body.thinkingLevel === 'string' ? body.thinkingLevel : undefined,
      model: isModelBody(body.model),
      extensions: Array.isArray(body.extensions)
        ? body.extensions.filter((e: unknown): e is string => typeof e === 'string')
        : undefined,
      tools: Array.isArray(body.tools)
        ? body.tools.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
      includeContextFiles: typeof body.includeContextFiles === 'boolean'
        ? body.includeContextFiles
        : undefined,
    }, 5 * 60_000)
    sendJson(response, 200, data)
    return
  }

  const commandMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commands$/)
  if (method === 'POST' && commandMatch) {
    const command = await readJsonBody(request)
    if (typeof command.type !== 'string' || command.type.length > 100)
      throw new HttpError(400, 'A valid Pi command type is required')
    const data = await manager.request(
      { action: 'command', sessionId: decodeURIComponent(commandMatch[1]), command },
      10 * 60_000,
    )
    sendJson(response, 200, data)
    return
  }

  if (method === 'GET' || method === 'HEAD') {
    await serveStatic(url.pathname, method, response)
    return
  }

  sendJson(response, 404, { error: 'Not found' })
}

async function piCommand(sessionId: string, command: JsonObject): Promise<JsonObject> {
  const response = await manager.request({ action: 'command', sessionId, command })
  if (!isObject(response)) throw new Error('Invalid response from Pi manager')
  return response
}

function objectData(response: JsonObject): JsonObject | null {
  return isObject(response.data) ? response.data : null
}

function arrayData(response: JsonObject, key: string): JsonObject[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter(isObject)
}

/** Canonicalizes a client-provided path and rejects missing paths or non-directories. */
async function resolveWorkingDirectory(input: string): Promise<string> {
  const trimmed = input.trim()
  if (!trimmed) throw new HttpError(400, 'Working directory is required')
  const expanded = expandHomePath(trimmed)
  let canonical: string
  try {
    canonical = await realpath(expanded)
  } catch {
    throw new HttpError(400, 'Working directory does not exist')
  }
  if (!(await stat(canonical)).isDirectory())
    throw new HttpError(400, 'Working directory must be a directory')
  return canonical
}

/** Returns only accessible subdirectories, with a navigable parent for the picker. */
async function listDirectories(path: string): Promise<DirectoryListing> {
  const canonicalPath = await resolveWorkingDirectory(path)
  const entries = await readdir(canonicalPath, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: resolve(canonicalPath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const parent = dirname(canonicalPath)
  return { path: canonicalPath, parentPath: parent === canonicalPath ? null : parent, directories }
}

/** Reads the JSON body with a size limit to protect the backend from oversized requests. */
async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new HttpError(413, 'Request body exceeds 2 MiB')
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isObject(value)) throw new Error('Expected an object')
    return value
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

/** Serves the frontend build while preventing an HTTP path from escaping the distribution directory. */
async function serveStatic(
  pathname: string,
  method: string,
  response: ServerResponse,
): Promise<void> {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
  let filePath = resolve(distDirectory, requestedPath)
  if (!filePath.startsWith(`${resolve(distDirectory)}${sep}`)) throw new HttpError(404, 'Not found')

  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file')
  } catch {
    filePath = resolve(distDirectory, 'index.html')
    try {
      if (!(await stat(filePath)).isFile()) throw new Error('Missing build')
    } catch {
      throw new HttpError(404, 'Frontend build not found; run npm run build')
    }
  }

  response.writeHead(200, { 'Content-Type': contentType(filePath) })
  if (method === 'HEAD') response.end()
  else createReadStream(filePath).pipe(response)
}

function broadcast(event: unknown): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`
  for (const client of eventClients) client.write(frame)
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

/** Maps a file extension to the MIME type served in the HTTP response. */
function contentType(filePath: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  return types[extname(filePath)] ?? 'application/octet-stream'
}
function isModelBody(value: unknown): { provider: string; modelId: string } | undefined {
  if (!isObject(value) || typeof value.provider !== 'string' || typeof value.modelId !== 'string')
    return undefined
  return { provider: value.provider, modelId: value.modelId }
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

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
