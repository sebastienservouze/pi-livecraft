import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { RecentSession } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { unnamedSessionName } from '../shared/session-names.ts'

const sessionDirectory = resolvePiSessionDirectory(process.env, homedir())

/** Resolves Pi's session storage using its configured profile before the default profile. */
export function resolvePiSessionDirectory(
  environment: { PI_CODING_AGENT_SESSION_DIR?: string; PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_SESSION_DIR
    ?? (environment.PI_CODING_AGENT_DIR
      ? join(environment.PI_CODING_AGENT_DIR, 'sessions')
      : join(homeDirectory, '.pi', 'agent', 'sessions'))
}

interface PiSessionHeader {
  type: 'session'
  id: string
  timestamp: string
  cwd: string
}

const MAX_SESSIONS = 30
const CANDIDATE_BUFFER = 100

/** Reads only the metadata required to resume a Pi session. */
export async function listRecentPiSessions(
  cwd: string,
  directory = sessionDirectory,
): Promise<RecentSession[]> {
  const paths = await listSessionFiles(directory)

  // stat is cheap, readFile is expensive: read only the most recent candidates
  const withMtime = await Promise.all(
    paths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  )
  const candidates = withMtime
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, CANDIDATE_BUFFER)

  const sessions = await Promise.all(
    candidates.map(({ path, mtime }) => readPiSession(path, mtime)),
  )

  return sessions
    .filter((session): session is RecentSession => session?.cwd === cwd)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SESSIONS)
}

/** Verifies that a file belongs to the Pi session directory before loading its metadata. */
export async function loadPiSession(path: string): Promise<RecentSession> {
  const [canonicalPath, canonicalDirectory] = await Promise.all([
    realpath(path),
    realpath(sessionDirectory),
  ])
  const relativePath = relative(canonicalDirectory, canonicalPath)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('Pi session file must be stored in the Pi session directory')
  const session = await readPiSession(canonicalPath, (await stat(canonicalPath)).mtimeMs)
  if (!session) throw new Error('Invalid Pi session file')
  return session
}

/** Recursively scans Pi storage while retaining only session JSONL files. */
async function listSessionFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSessionFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

/** Extracts a session's identity, name, and latest activity without loading its full history. */
async function readPiSession(path: string, updatedAt: number): Promise<RecentSession | null> {
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return null
  }
  let lines: string[]
  try {
    lines = (await readFile(path, 'utf8')).split('\n')
  } catch {
    return null
  }

  const header = parseHeader(lines[0])
  if (!header) return null
  let cwd: string
  try {
    cwd = await realpath(header.cwd)
  } catch {
    return null
  }
  let hasMessage = false
  let name: string | undefined
  let prompt: string | undefined
  let lastMessageAt: number | undefined
  for (let index = 1; index < lines.length; index += 1) {
    const value = parseLine(lines[index])
    if (!value) continue
    if (value.type === 'session_info' && typeof value.name === 'string' && value.name.trim()) {
      name = value.name.trim()
      continue
    }
    if (value.type !== 'message') continue
    hasMessage = true
    if (typeof value.timestamp === 'string') {
      const timestamp = Date.parse(value.timestamp)
      if (!Number.isNaN(timestamp) && (lastMessageAt === undefined || timestamp > lastMessageAt))
        lastMessageAt = timestamp
    }
    if (prompt === undefined && isObject(value.message) && value.message.role === 'user') {
      const content = textContent(value.message.content)
      if (content && !content.startsWith('/')) prompt = shortenPrompt(content)
    }
  }
  if (!hasMessage) return null
  const createdAt = Date.parse(header.timestamp)
  return {
    id: header.id,
    cwd,
    name: name || prompt || unnamedSessionName,
    sessionPath: canonicalPath,
    updatedAt: lastMessageAt ?? (Number.isNaN(createdAt) ? updatedAt : createdAt),
  }
}

function parseHeader(line: string | undefined): PiSessionHeader | null {
  const value = parseLine(line)
  if (
    !value || value.type !== 'session' || typeof value.id !== 'string'
    || typeof value.timestamp !== 'string' || typeof value.cwd !== 'string'
  ) return null
  return { type: 'session', id: value.id, timestamp: value.timestamp, cwd: value.cwd }
}

function parseLine(line: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line ?? '')
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function textContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part): part is Record<string, unknown> =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join(' ')
    .trim()
  return text || undefined
}

function shortenPrompt(prompt: string): string {
  const words = prompt.split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : prompt
}
function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
