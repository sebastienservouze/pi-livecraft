import type { RecentSession, SessionModel, SessionSummary } from '../../../shared/types.ts'

/** A thread shown inside a project section, normalized from recent history or a live managed session. */
export interface ProjectThread {
  key: string
  id: string
  name: string
  cwd: string
  sessionPath?: string
  updatedAt: number
  worker?: string
  model?: SessionModel
  thinkingLevel?: string
  pinned: boolean
  live: boolean
}

/** A project/repository section: a canonical workspace identity, its threads, and an attention summary. */
export interface ProjectGroup {
  path: string
  label: string
  isActiveWorkspace: boolean
  threads: ProjectThread[]
  archivedThreads: ProjectThread[]
  activeCount: number
}

interface GroupProjectsInput {
  recentSessions: RecentSession[]
  sessions: SessionSummary[]
  activeWorkspacePath: string
  projectOrder?: readonly string[]
  archivedProjects: readonly string[]
  pinnedSessions?: readonly string[]
  archivedSessions?: readonly string[]
}

/** Derives the display label for a project from the trailing segment of its canonical path. */
export function projectLabel(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean)
  return segments.at(-1) ?? path
}

const liveStatuses = new Set(['starting', 'running', 'idle'])

/**
 * Groups recent and live sessions into project sections keyed by canonical workspace path.
 *
 * The active workspace always appears (even when empty) so a thread can be created in it; other
 * projects appear when they carry live or attention-worthy work. Archived projects are hidden but
 * recoverable. A manually dragged `projectOrder` wins; unordered projects follow with the active
 * workspace first, then most recent activity — a stable order that survives refreshes.
 */
export function groupProjects(
  {
    recentSessions,
    sessions,
    activeWorkspacePath,
    projectOrder = [],
    archivedProjects,
    pinnedSessions = [],
    archivedSessions = [],
  }: GroupProjectsInput,
): ProjectGroup[] {
  const archived = new Set(archivedProjects)
  const pinnedThreadKeys = new Set(pinnedSessions)
  const archivedThreadKeys = new Set(archivedSessions)
  const threadsByProject = new Map<string, Map<string, ProjectThread>>()
  const archivedThreadsByProject = new Map<string, Map<string, ProjectThread>>()

  const ensure = (cwd: string): Map<string, ProjectThread> => {
    const existing = threadsByProject.get(cwd)
    if (existing) return existing
    const created = new Map<string, ProjectThread>()
    threadsByProject.set(cwd, created)
    return created
  }

  const ensureArchived = (cwd: string): Map<string, ProjectThread> => {
    const existing = archivedThreadsByProject.get(cwd)
    if (existing) return existing
    const created = new Map<string, ProjectThread>()
    archivedThreadsByProject.set(cwd, created)
    return created
  }

  for (const recent of recentSessions) {
    if (archived.has(recent.cwd)) continue
    const thread: ProjectThread = {
      key: recent.sessionPath,
      id: recent.id,
      name: recent.name,
      cwd: recent.cwd,
      sessionPath: recent.sessionPath,
      updatedAt: recent.updatedAt,
      model: recent.model,
      thinkingLevel: recent.thinkingLevel,
      pinned: pinnedThreadKeys.has(recent.sessionPath),
      live: false,
    }
    if (archivedThreadKeys.has(recent.sessionPath))
      ensureArchived(recent.cwd).set(thread.key, thread)
    else ensure(recent.cwd).set(thread.key, thread)
  }

  for (const session of sessions) {
    if (session.status === 'exited' || archived.has(session.cwd)) continue
    if (!liveStatuses.has(session.status)) continue
    const key = session.sessionPath ?? session.id
    const archivedKey = archivedThreadKeys.has(key) || archivedThreadKeys.has(session.id)
    const project = ensure(session.cwd)
    const target = archivedKey ? ensureArchived(session.cwd) : project
    const previous = target.get(key)
    target.set(key, {
      key,
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      sessionPath: session.sessionPath,
      updatedAt: previous?.updatedAt ?? Date.now(),
      worker: session.activeAgent,
      model: session.model ?? previous?.model,
      thinkingLevel: session.thinkingLevel ?? previous?.thinkingLevel,
      pinned: pinnedThreadKeys.has(key) || pinnedThreadKeys.has(session.id),
      live: true,
    })
  }

  if (!threadsByProject.has(activeWorkspacePath) && !archived.has(activeWorkspacePath))
    ensure(activeWorkspacePath)

  const paths = new Set([...threadsByProject.keys(), ...archivedThreadsByProject.keys()])
  const groups = [...paths].map((path): ProjectGroup => {
    const threads = threadsByProject.get(path) ?? new Map<string, ProjectThread>()
    const archivedThreads = archivedThreadsByProject.get(path) ?? new Map<string, ProjectThread>()
    const ordered = [...threads.values()].sort(compareThreads)
    return {
      path,
      label: projectLabel(path),
      isActiveWorkspace: path === activeWorkspacePath,
      threads: ordered,
      archivedThreads: [...archivedThreads.values()].sort(compareThreads),
      activeCount: ordered.filter((thread) => thread.live).length,
    }
  })

  const orderIndex = new Map(projectOrder.map((path, index) => [path, index]))
  return groups.sort((left, right) => {
    const leftIndex = orderIndex.get(left.path) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = orderIndex.get(right.path) ?? Number.MAX_SAFE_INTEGER
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    return compareGroups(left, right)
  })
}

function compareThreads(left: ProjectThread, right: ProjectThread): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.live !== right.live) return left.live ? -1 : 1
  return right.updatedAt - left.updatedAt
}

function compareGroups(left: ProjectGroup, right: ProjectGroup): number {
  if (left.isActiveWorkspace !== right.isActiveWorkspace) return left.isActiveWorkspace ? -1 : 1
  const leftLatest = latestActivity(left)
  const rightLatest = latestActivity(right)
  if (leftLatest !== rightLatest) return rightLatest - leftLatest
  return left.label.localeCompare(right.label)
}

function latestActivity(group: ProjectGroup): number {
  return group.threads.reduce((latest, thread) => Math.max(latest, thread.updatedAt), 0)
}
