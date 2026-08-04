import { useCallback, useEffect, useRef, useState } from 'react'
import { listDirectories, listRecentSessions, listSessions, sendPiCommand } from '../../api.ts'
import type { JsonObject, RecentSession, SessionSummary } from '../../../shared/types.ts'
import { promptSessionTitle } from '../composer/prompt-title.ts'
import { unnamedSessionName } from '../../../shared/session-names.ts'
import { recentWorkspaces } from './recent-workspaces.ts'
import { pickSessionOnOpen, sidebarSessions } from './sidebar-sessions.ts'

interface WorkspaceSessionsOptions {
  onDraftMessage: (sessionId: string, message: string) => void
  onError: (cause: unknown) => void
  onInitialMessageSent: () => void
  onSessionsRefreshed: (sessions: SessionSummary[]) => void
  onWorkspaceSelected: () => void
}

interface StartSessionOptions {
  draftMessage?: string
  initialMessage?: string
}

const COMPLETED_SESSIONS_KEY = 'pi-livecraft.completed-sessions'
const MAX_COMPLETED_SESSIONS = 30

/** Owns workspace selection, session lists, persistence, and session creation. */
export function useWorkspaceSessions(
  { onDraftMessage, onError, onInitialMessageSent, onSessionsRefreshed, onWorkspaceSelected }:
    WorkspaceSessionsOptions,
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sentSessions, setSentSessions] = useState<RecentSession[]>([])
  const [completedSessionIds, setCompletedSessionIds] = useState<ReadonlySet<string>>(
    readCompletedSessionIds,
  )
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(true)
  const [workspacePath, setWorkspacePath] = useState(() =>
    window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.'
  )
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState(() =>
    recentWorkspaces(
      window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.',
      readRecentWorkspaces(),
    )
  )
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)
  const sessionsRef = useRef(sessions)
  const sentSessionsRef = useRef(sentSessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const selectedIdRef = useRef(selectedId)
  const creatingSessionRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const autoSelectOnRefreshRef = useRef(true)
  sessionsRef.current = sessions
  sentSessionsRef.current = sentSessions
  completedSessionIdsRef.current = completedSessionIds
  selectedIdRef.current = selectedId

  useEffect(() => {
    if (window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
    let active = true
    void listDirectories('.')
      .then(({ path }) => {
        if (!active || window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
        setWorkspacePath(path)
        setRecentWorkspacePaths(recentWorkspaces(path, readRecentWorkspaces()))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (selectedId) window.localStorage.setItem('pi-livecraft.selected-session', selectedId)
    else window.localStorage.removeItem('pi-livecraft.selected-session')
    setCompletedSessionIds((current) => {
      const sessionKey = sessionsRef
        .current
        .find((session) => session.id === selectedId)
        ?.sessionPath ?? selectedId
      if (!current.has(sessionKey)) return current
      const next = new Set(current)
      next.delete(sessionKey)
      return next
    })
  }, [selectedId])

  useEffect(() => writeCompletedSessionIds(completedSessionIds), [completedSessionIds])

  /** Reloads sessions while discarding responses superseded by a newer workspace refresh. */
  const refreshSessions = useCallback(async (cwd = workspacePath) => {
    const version = ++refreshVersionRef.current
    const shouldAutoSelect = autoSelectOnRefreshRef.current
    setIsRefreshingSessions(true)
    try {
      const [nextSessions, nextRecentSessions] = await Promise.all([
        listSessions(),
        listRecentSessions(cwd),
      ])
      if (version !== refreshVersionRef.current) return
      const autoSelectId = shouldAutoSelect
        ? pickSessionOnOpen(
          sidebarSessions(nextRecentSessions, cwd, sentSessionsRef.current),
          nextSessions,
          completedSessionIdsRef.current,
        )
        : undefined
      const recentNames = new Map(
        nextRecentSessions.map((session) => [session.sessionPath, session.name]),
      )
      const namedSessions = nextSessions.map((session) => {
        const recentName = session.sessionPath ? recentNames.get(session.sessionPath) : undefined
        const previousName = sessionsRef.current.find((current) => current.id === session.id)?.name
        return recentName
          ? { ...session, name: recentName }
          : previousName && previousName !== unnamedSessionName
          ? { ...session, name: previousName }
          : session
      })
      setSessions(namedSessions)
      setCompletedSessionIds((current) => {
        if (current.size === 0) return current
        const sessionKeys = new Set(
          nextSessions.flatMap((session) =>
            [session.id, session.sessionPath].filter((key): key is string => Boolean(key))
          ),
        )
        const recentKeys = new Set(nextRecentSessions.map((session) => session.sessionPath))
        const next = new Set(
          [...current].filter((key) => sessionKeys.has(key) || recentKeys.has(key)),
        )
        return next.size === current.size ? current : next
      })
      setRecentSessions(nextRecentSessions)
      setSentSessions((current) =>
        current.filter((sent) =>
          !nextRecentSessions.some((recent) =>
            recent.id === sent.id || recent.sessionPath === sent.sessionPath
          )
        )
      )
      if (shouldAutoSelect) {
        autoSelectOnRefreshRef.current = false
        setSelectedId(autoSelectId ?? '')
      } else {
        setSelectedId((current) =>
          nextSessions.some((session) => session.id === current) ? current : ''
        )
      }
      onSessionsRefreshed(nextSessions)
    } catch (cause) {
      if (version === refreshVersionRef.current) onError(cause)
    } finally {
      if (version === refreshVersionRef.current) setIsRefreshingSessions(false)
    }
  }, [onError, onSessionsRefreshed, workspacePath])

  useEffect(() => void refreshSessions(), [refreshSessions])

  /** Selects a workspace, optionally preserving an explicit session over automatic selection. */
  const selectWorkspace = useCallback((path: string, targetSessionId?: string): void => {
    window.localStorage.setItem('pi-livecraft.workspace-path', path)
    const nextRecentWorkspacePaths = recentWorkspaces(path, recentWorkspacePaths)
    window.localStorage.setItem(
      'pi-livecraft.recent-workspace-paths',
      JSON.stringify(nextRecentWorkspacePaths),
    )
    setRecentWorkspacePaths(nextRecentWorkspacePaths)
    onWorkspaceSelected()
    setWorkspacePath(path)
    setSelectedId(targetSessionId ?? '')
    setDirectoryPickerOpen(false)
    autoSelectOnRefreshRef.current = targetSessionId === undefined
    void refreshSessions(path)
  }, [onWorkspaceSelected, recentWorkspacePaths, refreshSessions])

  /** Stores the optimistic title shared by first prompts in new and existing sessions. */
  const nameSessionFromFirstPrompt = useCallback(
    (session: SessionSummary, message: string): void => {
      const name = promptSessionTitle(message)
      setSessions((current) =>
        current.map((candidate) => candidate.id === session.id ? { ...candidate, name } : candidate)
      )
      const sessionPath = session.sessionPath
      if (!sessionPath) return
      setSentSessions((current) => [
        {
          id: session.id,
          cwd: session.cwd,
          name,
          sessionPath,
          updatedAt: Date.now(),
        },
        ...current.filter((recent) =>
          recent.id !== session.id && recent.sessionPath !== sessionPath
        ),
      ])
    },
    [],
  )

  /** Launches and selects a session, then sends or prepares its optional first prompt.
   *  Returns the created session summary, or null when an error prevented the operation. */
  const startAndSelectSession = useCallback(
    async (
      start: () => Promise<SessionSummary>,
      options: StartSessionOptions = {},
    ): Promise<SessionSummary | null> => {
      creatingSessionRef.current = true
      setCreatingSession(true)
      setSelectedId('')
      try {
        const session = await start()
        await refreshSessions()
        setSelectedId(session.id)
        if (options.draftMessage) onDraftMessage(session.id, options.draftMessage)
        if (options.initialMessage) {
          await sendPiCommand(session.id, { type: 'prompt', message: options.initialMessage })
          nameSessionFromFirstPrompt(session, options.initialMessage)
          await refreshSessions()
          onInitialMessageSent()
        }
        return session
      } catch (cause) {
        onError(cause)
        return null
      } finally {
        creatingSessionRef.current = false
        setCreatingSession(false)
      }
    },
    [nameSessionFromFirstPrompt, onDraftMessage, onError, onInitialMessageSent, refreshSessions],
  )

  const updateSession = useCallback(
    (
      sessionId: string,
      update: Partial<Pick<SessionSummary, 'activeAgent' | 'name' | 'status'>>,
    ): void => {
      setSessions((current) =>
        current.map((session) => session.id === sessionId ? { ...session, ...update } : session)
      )
    },
    [],
  )

  /** Applies a manager-provided name consistently across live and recent session lists. */
  const renameSession = useCallback((sessionId: string, name: string): void => {
    const sessionPath = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
    setSessions((current) =>
      current.map((session) => session.id === sessionId ? { ...session, name } : session)
    )
    if (!sessionPath) return
    setRecentSessions((current) =>
      current.map((session) => session.sessionPath === sessionPath ? { ...session, name } : session)
    )
    setSentSessions((current) =>
      current.map((session) =>
        session.id === sessionId || session.sessionPath === sessionPath
          ? { ...session, name }
          : session
      )
    )
  }, [])

  /** Adds or replaces a pending UI request for a session. */
  const addPendingRequest = useCallback((sessionId: string, request: JsonObject): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: [
              ...session
                .pendingUi
                .filter((pending) => pending.id !== request.id),
              request,
            ],
          }
          : session
      )
    )
  }, [])

  /** Removes an answered UI request before the next manager reconciliation. */
  const removePendingRequest = useCallback((sessionId: string, requestId: string): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: session.pendingUi.filter((request) => request.id !== requestId),
          }
          : session
      )
    )
  }, [])

  const markSessionCompleted = useCallback((sessionId: string): void => {
    if (sessionId === selectedIdRef.current) return
    const sessionKey = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
      ?? sessionId
    setCompletedSessionIds((current) => new Set(current).add(sessionKey))
  }, [])

  const selectCreatedSession = useCallback((sessionId: string): void => {
    if (!creatingSessionRef.current) return
    setSelectedId(sessionId)
    creatingSessionRef.current = false
  }, [])

  return {
    addPendingRequest,
    completedSessionIds,
    creatingSession,
    directoryPickerOpen,
    isRefreshingSessions,
    markSessionCompleted,
    nameSessionFromFirstPrompt,
    recentSessions,
    recentWorkspacePaths,
    refreshSessions,
    removePendingRequest,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessions,
    setDirectoryPickerOpen,
    setSelectedId,
    selectWorkspace,
    startAndSelectSession,
    updateSession,
    workspacePath,
  }
}

/** Reads the persisted list of recent workspace paths from localStorage. */
function readRecentWorkspaces(): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('pi-livecraft.recent-workspace-paths') ?? '[]',
    )
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string')
      : []
  } catch {
    return []
  }
}

/** Restores completed-session identifiers persisted across same-tab refreshes. */
function readCompletedSessionIds(): ReadonlySet<string> {
  try {
    const stored = sessionStorage.getItem(COMPLETED_SESSIONS_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return new Set(ids.slice(0, MAX_COMPLETED_SESSIONS))
  } catch {
    return new Set()
  }
}

/** Persists completed-session identifiers so they survive a page refresh within the same tab. */
function writeCompletedSessionIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) sessionStorage.removeItem(COMPLETED_SESSIONS_KEY)
    else sessionStorage.setItem(
        COMPLETED_SESSIONS_KEY,
        JSON.stringify([...ids].slice(0, MAX_COMPLETED_SESSIONS)),
      )
  } catch {
    // sessionStorage may be unavailable
  }
}
