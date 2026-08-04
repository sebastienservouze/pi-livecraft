import type { RecentSession, SessionSummary } from '../../../shared/types.ts'

/** A thread shown inside a project section, normalized from recent history or a live managed session. */
export interface ProjectThread {
  key: string
  id: string
  name: string
  cwd: string
  sessionPath?: string
  updatedAt: number
  worker?: string
  live: boolean
}

/** A project/repository section: a canonical workspace identity, its threads, and an attention summary. */
export interface ProjectGroup {
  path: string
  label: string
  pinned: boolean
  isActiveWorkspace: boolean
  threads: ProjectThread[]
  activeCount: number
}

interface GroupProjectsInput {
  recentSessions: RecentSession[]
  sessions: SessionSummary[]
  activeWorkspacePath: string
  pinnedProjects: readonly string[]
  archivedProjects: readonly string[]
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
 * projects appear when they carry live or attention-worthy work, plus any pinned project. Archived
 * projects are hidden but recoverable through the returned pin/archive preferences. Pinned projects
 * lead, then the active workspace, then remaining projects by most recent activity — a stable order
 * that survives refreshes.
 */
export function groupProjects(
  { recentSessions, sessions, activeWorkspacePath, pinnedProjects, archivedProjects }:
    GroupProjectsInput,
): ProjectGroup[] {
  const archived = new Set(archivedProjects)
  const pinned = new Set(pinnedProjects)
  const threadsByProject = new Map<string, Map<string, ProjectThread>>()

  const ensure = (cwd: string): Map<string, ProjectThread> => {
    const existing = threadsByProject.get(cwd)
    if (existing) return existing
    const created = new Map<string, ProjectThread>()
    threadsByProject.set(cwd, created)
    return created
  }

  for (const recent of recentSessions) {
    if (archived.has(recent.cwd)) continue
    ensure(recent.cwd).set(recent.sessionPath, {
      key: recent.sessionPath,
      id: recent.id,
      name: recent.name,
      cwd: recent.cwd,
      sessionPath: recent.sessionPath,
      updatedAt: recent.updatedAt,
      live: false,
    })
  }

  for (const session of sessions) {
    if (session.status === 'exited' || archived.has(session.cwd)) continue
    if (!liveStatuses.has(session.status)) continue
    const key = session.sessionPath ?? session.id
    const project = ensure(session.cwd)
    const previous = project.get(key)
    project.set(key, {
      key,
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      sessionPath: session.sessionPath,
      updatedAt: previous?.updatedAt ?? Date.now(),
      worker: session.activeAgent,
      live: true,
    })
  }

  if (!threadsByProject.has(activeWorkspacePath) && !archived.has(activeWorkspacePath))
    ensure(activeWorkspacePath)
  for (const path of pinned) {
    if (!threadsByProject.has(path) && !archived.has(path)) ensure(path)
  }

  const groups = [...threadsByProject.entries()].map(([path, threads]): ProjectGroup => {
    const ordered = [...threads.values()].sort(compareThreads)
    return {
      path,
      label: projectLabel(path),
      pinned: pinned.has(path),
      isActiveWorkspace: path === activeWorkspacePath,
      threads: ordered,
      activeCount: ordered.filter((thread) => thread.live).length,
    }
  })

  return groups.sort(compareGroups)
}

function compareThreads(left: ProjectThread, right: ProjectThread): number {
  if (left.live !== right.live) return left.live ? -1 : 1
  return right.updatedAt - left.updatedAt
}

function compareGroups(left: ProjectGroup, right: ProjectGroup): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.isActiveWorkspace !== right.isActiveWorkspace) return left.isActiveWorkspace ? -1 : 1
  const leftLatest = latestActivity(left)
  const rightLatest = latestActivity(right)
  if (leftLatest !== rightLatest) return rightLatest - leftLatest
  return left.label.localeCompare(right.label)
}

function latestActivity(group: ProjectGroup): number {
  return group.threads.reduce((latest, thread) => Math.max(latest, thread.updatedAt), 0)
}
