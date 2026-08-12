import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import {
  commitChanges,
  createSession,
  discardChanges,
  getGitFileDiff,
  getGitSnapshot,
  getQuotas,
  improvePrompt,
  openExplorer,
  openSession,
  openTerminal,
  pushCommits,
  refreshQuotas,
  resetGitCommit,
  restartManager,
  revertGitCommit,
  savePrompt,
  sendPiCommand,
  subscribeManagerEvents,
} from './api.ts'
import {
  openFolderAction,
  openTerminalAction,
} from './features/terminal/hermes-host-actions.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  GitSnapshot,
  JsonObject,
  ManagerRuntimeStatus,
  QuotaSnapshot,
  SessionSummary,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { Composer } from './features/composer/Composer.tsx'
import { ToastStack, type Toast } from './features/notifications/ToastStack.tsx'
import { sessionActivity, type PiConnection } from './features/conversation/activity.ts'
import { Conversation } from './features/conversation/Conversation.tsx'
import { useConversationRuntime } from './features/conversation/useConversationRuntime.ts'
import { AskUserQuestionDialog, ExtensionDialog } from './features/dialogs/Dialogs.tsx'
import {
  isAgentSelector,
  isAskUserQuestionDialog,
  isBlockingDialog,
  type UiDialog,
} from './features/dialogs/dialog-protocol.ts'
import {
  clampRightSidebarWidth,
  isRightWidget,
  readRightSidebarWidth,
  type RightWidget,
} from './features/right-sidebar/right-sidebar.ts'
import { RightSidebar } from './features/right-sidebar/RightSidebar.tsx'
import { quotaProviderForModel } from './features/quotas/quota-display.ts'
import { DirectoryPicker } from './features/workspace/DirectoryPicker.tsx'
import { sidebarSessions } from './features/workspace/sidebar-sessions.ts'
import { useWorkspaceSessions } from './features/workspace/useWorkspaceSessions.ts'
import { WorkspaceSidebar } from './features/workspace/WorkspaceSidebar.tsx'
import {
  clampWorkspaceSidebarWidth,
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
} from './features/workspace/workspace-sidebar.ts'
import { CommandPalette, type PaletteCommand } from './features/commands/CommandPalette.tsx'
import {
  commandDefinitions,
  defaultShortcuts,
  lastAssistantText,
  migrateLegacyShortcut,
  rightWidgetFromCommand,
  shortcutFromEvent,
  type CommandId,
} from './features/commands/command-registry.ts'
import { SettingsPanel } from './features/settings/SettingsPanel.tsx'
import { ManagerRuntimeNotice } from './features/manager/ManagerRuntimeNotice.tsx'
import {
  allThemes,
  applyThemePalette,
  deleteTheme,
  duplicateTheme,
  persistThemePreferences,
  readThemePreferences,
  renameTheme,
  resetTheme,
  resolveActiveTheme,
  setActiveTheme,
  shadowForMode,
  updateThemeColor,
  type ThemeVariable,
} from './features/settings/themes.ts'
import {
  persistBackendBaseUrl,
  readBackendBaseUrl,
  resetBackendBaseUrl,
} from './features/settings/backend-connection.ts'
import {
  analyzeSession,
  type SessionAnalysisTarget,
} from './features/session-analysis/session-analysis.ts'
import './features/commands/commands.css'

const emptyAgentOptions: string[] = []
const conversationViewDetails = {
  simple: { label: 'Simplified view', description: 'Messages only, without tool calls' },
  'semi-detailed': {
    label: 'Semi-detailed view',
    description: 'Tool headers only; click one to expand it',
  },
  detailed: { label: 'Detailed view', description: 'Visible calls with expandable preview' },
} as const
type ConversationView = keyof typeof conversationViewDetails

const gitRefreshDelayMs = 250
const managerUnavailableMessage = 'Pi manager is unavailable'
const managerUnavailableToastDelayMs = 1_000

function nextConversationView(current: ConversationView): ConversationView {
  if (current === 'simple') return 'semi-detailed'
  if (current === 'semi-detailed') return 'detailed'
  return 'simple'
}
/** Orchestrates workspace state, Pi events, and UI panels. */
function App() {
  // Workspace and sessions
  const [compactingSessionIds, setCompactingSessionIds] = useState<ReadonlySet<string>>(new Set())

  // Conversation and Pi lifecycle
  const [piConnection, setPiConnection] = useState<PiConnection>('connecting')
  const [managerRuntimeStatus, setManagerRuntimeStatus] = useState<ManagerRuntimeStatus>({
    state: 'disconnected',
    canRestart: false,
  })
  const [conversationView, setConversationView] = useState<ConversationView>(() => {
    const stored = window.localStorage.getItem('pi-livecraft.conversation-view')
    if (stored === 'detailed' || stored === 'simple-expanded') return 'detailed'
    if (stored === 'semi-detailed') return 'semi-detailed'
    if (stored === 'simple') return 'simple'
    return window.localStorage.getItem('pi-livecraft.detailed-view') === 'false'
      ? 'simple'
      : 'detailed'
  })
  const conversationViewDetail = conversationViewDetails[conversationView]

  // Dialogs and notifications
  const [agentOptions, setAgentOptions] = useState<Record<string, string[]>>({})
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  const [agentOptionsLoading, setAgentOptionsLoading] = useState<Record<string, boolean>>({})
  const agentOptionsLoadingRef = useRef(agentOptionsLoading)
  useEffect(() => {
    agentOptionsLoadingRef.current = agentOptionsLoading
  }, [agentOptionsLoading])
  const [dialog, setDialog] = useState<UiDialog | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Workspace tools and sidebars
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(() =>
    readWorkspaceSidebarWidth(window.localStorage.getItem('pi-livecraft.workspace-sidebar-width'))
  )
  const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsed] = useState(() =>
    readWorkspaceSidebarCollapsed(
      window.localStorage.getItem('pi-livecraft.workspace-sidebar-collapsed'),
    )
  )
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot | null>(null)
  const [activeRightWidget, setActiveRightWidget] = useState<RightWidget | null>(
    readActiveRightWidget,
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidth(
      window.localStorage.getItem('pi-livecraft.right-sidebar-width') ?? window
        .localStorage
        .getItem('pi-livecraft.git-sidebar-width'),
    )
  )

  // Preferences and commands
  const [themePreferences, setThemePreferences] = useState(() => readThemePreferences())
  const [themePreview, setThemePreview] = useState<
    ReturnType<typeof resolveActiveTheme> | undefined
  >(
    undefined,
  )
  const [backendBaseUrl, setBackendBaseUrl] = useState(() => readBackendBaseUrl())
  const appShellRef = useRef<HTMLDivElement>(null)
  const activeTheme = useMemo(() => resolveActiveTheme(themePreferences), [themePreferences])
  const displayedTheme = themePreview ?? activeTheme
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Transient UI requests and measurements
  type LoadingPhase = 'hidden' | 'entering' | 'visible' | 'exiting'
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('hidden')
  const [requestedSelect, setRequestedSelect] = useState<'agent' | 'model' | 'thinking' | null>(
    null,
  )
  const [submitRequest, setSubmitRequest] = useState(0)
  const [focusComposerRequest, setFocusComposerRequest] = useState(0)
  const [composerDraftRequest, setComposerDraftRequest] = useState<
    { id: string; message: string; sessionId: string }
  >()
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState(0)
  const [conversationNavigation, setConversationNavigation] = useState<
    { id: number; target: SessionAnalysisTarget }
  >()
  const [shortcuts, setShortcuts] = useState(() => readShortcuts())
  const [terminalCommand, setTerminalCommand] = useState(() => readTerminalCommand())

  // Workspace and session synchronization
  const selectedIdRef = useRef(window.localStorage.getItem('pi-livecraft.selected-session') ?? '')
  const replayPiEventRef = useRef<
    (sessionId: string, event: JsonObject, sequence?: number) => void
  >(() => undefined)
  const replayPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      replayPiEventRef.current(sessionId, event, sequence)
    },
    [],
  )

  // UI and capability synchronization
  const loadingTimerRef = useRef<number>(0)
  const gitRefreshVersionRef = useRef(0)
  const gitRefreshTimerRef = useRef<number | undefined>(undefined)
  const agentResponsesSentRef = useRef(new Set<string>())

  // Conversation timing and quotas
  const quotaAutoRefreshAtRef = useRef(new Map<string, number>())
  const quotasRef = useRef(quotas)
  quotasRef.current = quotas

  const dismissingRef = useRef(new Set<string>())
  const pendingManagerUnavailableToastsRef = useRef(new Map<string, number>())

  // Notifications
  /** Marks a toast as dismissing, then removes it after the exit animation. */
  const startDismissal = useCallback((id: string) => {
    if (dismissingRef.current.has(id)) return
    dismissingRef.current.add(id)
    setToasts((current) =>
      current.map((toast) => toast.id === id ? { ...toast, dismissing: true } : toast)
    )
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
      dismissingRef.current.delete(id)
    }, 160)
  }, [])

  const showToast = useCallback(
    (kind: Toast['kind'], message: string, sessionId: string | null = selectedIdRef.current) => {
      const toast = { id: crypto.randomUUID(), kind, message, sessionId }
      const publish = () => {
        pendingManagerUnavailableToastsRef.current.delete(toast.id)
        setToasts((current) => [...current, toast])
        if (kind !== 'error') window.setTimeout(() => startDismissal(toast.id), 3000)
      }
      if (kind === 'error' && message === managerUnavailableMessage) {
        const timer = window.setTimeout(publish, managerUnavailableToastDelayMs)
        pendingManagerUnavailableToastsRef.current.set(toast.id, timer)
        return
      }
      publish()
    },
    [startDismissal],
  )
  const clearManagerUnavailableToasts = useCallback(() => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
    pendingManagerUnavailableToastsRef.current.clear()
    setToasts((current) => current.filter((toast) => toast.message !== managerUnavailableMessage))
  }, [])
  useEffect(() => () => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
  }, [])

  /** Removes a toast after explicit dismissal or automatic timeout. */
  const dismissToast = useCallback((id: string) => startDismissal(id), [startDismissal])

  /** Restores visible dialogs and resolves stale agent selectors that block manager restart. */
  const handleSessionsRefreshed = useCallback((nextSessions: SessionSummary[]): void => {
    // Restore user-facing dialogs (excludes agent selectors which are handled silently)
    const pending = nextSessions
      .flatMap((session) =>
        session.pendingUi.map((request) => ({ sessionId: session.id, request }))
      )
      .find(({ request }) => !isAgentSelector(request))
    setDialog((current) =>
      pending
        ?? (current && nextSessions.some(({ id }) => id === current.sessionId) ? current : null)
    )
    // Resolve stale agent selectors that were missed during an SSE disconnect.
    // Options are fetched on demand when the user opens the dropdown.
    for (const session of nextSessions) {
      for (const request of session.pendingUi) {
        if (!isAgentSelector(request)) continue
        const key = `${session.id}:${request.id}`
        if (agentResponsesSentRef.current.has(key)) continue
        agentResponsesSentRef.current.add(key)
        void sendPiCommand(session.id, {
          type: 'extension_ui_response',
          id: request.id,
          cancelled: true,
        })
          .catch((cause) => {
            agentResponsesSentRef.current.delete(key)
            showToast('error', messageOf(cause))
          })
      }
    }
  }, [showToast])
  const handleWorkspaceSelected = useCallback((): void => {
    setGitSnapshot(null)
    setActiveRightWidget(null)
  }, [])
  const handleSessionDraft = useCallback((sessionId: string, message: string): void => {
    setComposerDraftRequest({ id: crypto.randomUUID(), message, sessionId })
  }, [])
  const handleInitialMessageSent = useCallback(
    (): void => setScrollToBottomRequest((current) => current + 1),
    [],
  )
  const handleWorkspaceError = useCallback(
    (cause: unknown): void => showToast('error', messageOf(cause)),
    [showToast],
  )
  const {
    addPendingRequest,
    closeManagedSession,
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
    renameManagedSession,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessions,
    setDirectoryPickerOpen,
    setSelectedId,
    selectWorkspace,
    startAndSelectSession: startWorkspaceSession,
    updateSession,
    workspacePath,
  } = useWorkspaceSessions({
    onDraftMessage: handleSessionDraft,
    onError: handleWorkspaceError,
    onInitialMessageSent: handleInitialMessageSent,
    onSessionsRefreshed: handleSessionsRefreshed,
    onWorkspaceSelected: handleWorkspaceSelected,
  })
  selectedIdRef.current = selectedId

  const startAndSelectSession = useCallback(
    (
      start: () => Promise<SessionSummary>,
      initialMessage?: string,
      draftMessage?: string,
    ): Promise<SessionSummary | null> =>
      startWorkspaceSession(start, { draftMessage, initialMessage }),
    [startWorkspaceSession],
  )

  const {
    activity,
    addOptimisticUserMessage,
    addPendingSteering,
    clearActivity,
    flushLiveUpdates,
    handlePiEvent,
    liveMessages,
    observedRequestDurations,
    observedToolDurations,
    pendingSteering,
    refreshSnapshot,
    removeLiveMessage,
    removePendingSteering,
    resetEventSequence,
    snapshot,
    snapshotSessionId,
    toolExecutions,
  } = useConversationRuntime(selectedId, handleWorkspaceError, replayPiEvent)
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : undefined
  const currentQuotaProvider = quotaProviderForModel(model?.provider)
  const currentQuotaProviderRef = useRef(currentQuotaProvider)
  currentQuotaProviderRef.current = currentQuotaProvider

  const visibleToasts = toasts.filter((toast) =>
    toast.sessionId === null || toast.sessionId === selectedId
  )

  // Sidebar preferences
  const updateWorkspaceSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampWorkspaceSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.workspace-sidebar-width', String(nextWidth))
    setWorkspaceSidebarWidth(nextWidth)
  }, [])

  const toggleWorkspaceSidebar = useCallback(() => {
    const nextCollapsed = !workspaceSidebarCollapsed
    window.localStorage.setItem(
      'pi-livecraft.workspace-sidebar-collapsed',
      String(nextCollapsed),
    )
    setWorkspaceSidebarCollapsed(nextCollapsed)
  }, [workspaceSidebarCollapsed])

  const updateRightSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampRightSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.right-sidebar-width', String(nextWidth))
    setRightSidebarWidth(nextWidth)
  }, [])

  const openRightWidget = useCallback((widget: RightWidget) => {
    window.localStorage.setItem('pi-livecraft.right-sidebar-widget', widget)
    setActiveRightWidget(widget)
  }, [])

  // Theme preferences
  const selectTheme = useCallback((id: string) => {
    setThemePreferences((current) => setActiveTheme(current, id))
  }, [])

  const duplicateActiveTheme = useCallback(() => {
    setThemePreferences((current) => {
      const source = resolveActiveTheme(current)
      const duplicated = duplicateTheme(current, source.id, `${source.name} custom`)
      const created = duplicated.themes.at(-1)
      return created ? setActiveTheme(duplicated, created.id) : duplicated
    })
  }, [])

  const renameSelectedTheme = useCallback((id: string, name: string) => {
    setThemePreferences((current) => renameTheme(current, id, name))
  }, [])

  const updateSelectedThemeColor = useCallback(
    (id: string, variable: ThemeVariable, color: string) => {
      setThemePreferences((current) => updateThemeColor(current, id, variable, color))
    },
    [],
  )

  const deleteSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => deleteTheme(current, id))
  }, [])

  const resetSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => resetTheme(current, id))
  }, [])

  useEffect(() => {
    persistThemePreferences(themePreferences)
  }, [themePreferences])

  useEffect(() => {
    const shell = appShellRef.current
    if (!shell) return
    shell.dataset.theme = displayedTheme.mode
    applyThemePalette(shell, displayedTheme.palette)
    const shadows = shadowForMode(displayedTheme.mode)
    shell.style.setProperty('--shadow', shadows.shadow)
    shell.style.setProperty('--shadow-soft', shadows['shadow-soft'])
  }, [displayedTheme])

  // Dialogs
  /** Clears an answered request immediately, then reconciles all pending requests with the manager. */
  const closeDialog = useCallback((closedDialog: UiDialog) => {
    const requestId = closedDialog.request.id
    setDialog((current) =>
      current?.sessionId === closedDialog.sessionId && current.request.id === requestId
        ? null
        : current
    )
    if (typeof requestId === 'string') removePendingRequest(closedDialog.sessionId, requestId)
    void refreshSessions()
  }, [refreshSessions, removePendingRequest])

  // Workspace capabilities
  /** Refreshes Git state for the current directory. Throws when requested so callers can handle the error. */
  const refreshGit = useCallback(async (cwd = workspacePath, notifyOnError = false) => {
    if (gitRefreshTimerRef.current !== undefined) {
      window.clearTimeout(gitRefreshTimerRef.current)
      gitRefreshTimerRef.current = undefined
    }
    const version = ++gitRefreshVersionRef.current
    try {
      const nextSnapshot = await getGitSnapshot(cwd)
      if (version === gitRefreshVersionRef.current) setGitSnapshot(nextSnapshot)
    } catch (cause) {
      if (notifyOnError && version === gitRefreshVersionRef.current) throw cause
    }
  }, [workspacePath])
  /** Schedules one Git refresh for a burst of completed tools. */
  const scheduleGitRefresh = useCallback((cwd = workspacePath): void => {
    if (gitRefreshTimerRef.current !== undefined)
      window.clearTimeout(gitRefreshTimerRef.current)
    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = undefined
      void refreshGit(cwd)
    }, gitRefreshDelayMs)
  }, [refreshGit, workspacePath])

  /** Refreshes quotas, allowing manual clicks to bypass automatic throttling. */
  const refreshSessionQuotas = useCallback(
    async (sessionId: string, automatic: boolean): Promise<void> => {
      if (!sessionId) throw new Error('An open Pi session is required to refresh quotas.')
      if (automatic) {
        const provider = currentQuotaProviderRef.current
        if (!provider) return
        const lastRefreshAt = Math.max(
          quotasRef
            .current
            ?.[provider]
            .updatedAt ?? 0,
          quotaAutoRefreshAtRef.current.get(sessionId) ?? 0,
        )
        const now = Date.now()
        if (!quotaRefreshAllowed(lastRefreshAt, true, now)) return
        quotaAutoRefreshAtRef.current.set(sessionId, now)
      }
      try {
        setQuotas((current) => current && { ...current, refreshing: true })
        setQuotas(await refreshQuotas(sessionId, automatic))
      } catch (cause) {
        if (!automatic) showToast('error', messageOf(cause))
        setQuotas(await getQuotas().catch(() => quotasRef.current))
      }
    },
    [showToast],
  )

  /** Sends /agent to Pi, intercepts the resulting selector silently, and caches its options. */
  const fetchAgentOptions = useCallback((sessionId: string) => {
    if (agentOptionsLoadingRef.current[sessionId] || agentOptions[sessionId]) return
    setAgentOptionsLoading((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: '/agent' })
      .catch((cause) => {
        setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
        showToast('error', messageOf(cause))
      })
  }, [agentOptions, showToast])

  /** Activates an agent directly without opening the interactive selector. */
  const activateAgent = useCallback((sessionId: string, agentName: string) => {
    if (agentBusy[sessionId]) return
    setAgentBusy((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: `/agent ${agentName}` })
      .then(() => refreshSnapshot(sessionId))
      .catch((cause) => showToast('error', messageOf(cause)))
      .finally(() => setAgentBusy((current) => ({ ...current, [sessionId]: false })))
  }, [agentBusy, refreshSnapshot, showToast])

  // Initial application synchronization
  useEffect(() => {
    void refreshGit()
    return () => {
      if (gitRefreshTimerRef.current !== undefined) {
        window.clearTimeout(gitRefreshTimerRef.current)
        gitRefreshTimerRef.current = undefined
      }
    }
  }, [refreshGit])
  useEffect(() => {
    void getQuotas().then(setQuotas).catch(() => undefined)
  }, [])

  // Selected session synchronization
  useEffect(() => setConversationNavigation(undefined), [selectedId])

  // Pi event stream
  /** Routes a live or replayed Pi event through cross-feature effects before the conversation runtime. */
  const handleManagerPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      if (event.type === 'session_info_changed') {
        const name = typeof event.name === 'string' && event.name.trim()
          ? event.name.trim()
          : 'New session'
        renameSession(sessionId, name)
      }
      if (event.type === 'agent_start') updateSession(sessionId, { status: 'running' })
      if (event.type === 'agent_settled') {
        updateSession(sessionId, { status: 'idle' })
        markSessionCompleted(sessionId)
      }
      if (event.type === 'compaction_start')
        setCompactingSessionIds((current) => new Set(current).add(sessionId))
      if (event.type === 'compaction_end')
        setCompactingSessionIds((current) => {
          if (!current.has(sessionId)) return current
          const next = new Set(current)
          next.delete(sessionId)
          return next
        })
      if (
        event.type === 'auto_retry_end' && event.success === false && typeof event
            .finalError === 'string'
      ) {
        showToast(
          'error',
          `Provider connection failed after retries: ${event.finalError}`,
          sessionId,
        )
      }
      if (event.type === 'tool_execution_end') scheduleGitRefresh()
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'agent'
      ) {
        updateSession(sessionId, {
          activeAgent: typeof event.activeAgent === 'string' ? event.activeAgent : undefined,
        })
      }
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'pi-livecraft.quotas'
      ) {
        void getQuotas().then(setQuotas).catch(() => undefined)
      }
      if (
        event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)
      ) {
        // Commit batched assistant deltas before a blocking dialog covers the conversation.
        if (sessionId === selectedIdRef.current) flushLiveUpdates()
        if (typeof event.id === 'string') addPendingRequest(sessionId, event)
        if (sessionId === selectedIdRef.current) clearActivity()
      }
      if (event.type === 'extension_ui_request') {
        if (
          event.method === 'notify' || (event.method === 'setStatus' && event.statusKey === 'agent')
        ) selectCreatedSession(sessionId)
        if (event.method === 'notify' && typeof event.message === 'string')
          showToast('notice', event.message, sessionId)
        // Intercept agent selector silently when the plugin requested the options list.
        if (isAgentSelector(event) && agentOptionsLoadingRef.current[sessionId]) {
          const options = event.options.filter((o): o is string => typeof o === 'string')
          setAgentOptions((current) => ({ ...current, [sessionId]: options }))
          setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
          void sendPiCommand(sessionId, {
            type: 'extension_ui_response',
            id: event.id,
            cancelled: true,
          })
            .catch((cause) => showToast('error', messageOf(cause)))
          return
        }
        if (isAgentSelector(event)) {
          // Pi-initiated selector (e.g. user typed /agent in Pi terminal) — show as normal dialog.
          if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
          return
        }
        if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
      }

      const selected = sessionId === selectedIdRef.current
      if (selected && event.type === 'agent_settled') void refreshSessionQuotas(sessionId, true)
      handlePiEvent(sessionId, event, sequence)
      if (selected && event.type === 'agent_settled')
        setFocusComposerRequest((current) => current + 1)
    },
    [
      addPendingRequest,
      clearActivity,
      flushLiveUpdates,
      handlePiEvent,
      markSessionCompleted,
      refreshSessionQuotas,
      scheduleGitRefresh,
      renameSession,
      selectCreatedSession,
      showToast,
      updateSession,
    ],
  )
  replayPiEventRef.current = handleManagerPiEvent

  useEffect(() =>
    subscribeManagerEvents((managerEvent) => {
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'manager_disconnected'
      ) {
        setPiConnection(managerEvent.event === 'manager_connected' ? 'connected' : 'disconnected')
        if (managerEvent.event === 'manager_connected') clearManagerUnavailableToasts()
        clearActivity()
      }
      if (managerEvent.event === 'manager_status' && isManagerRuntimeStatus(managerEvent.data))
        setManagerRuntimeStatus(managerEvent.data)
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'session_created'
        || managerEvent.event === 'session_exited' || managerEvent.event === 'session_reassigned'
      ) void refreshSessions()
      if (managerEvent.event === 'pi' && isObject(managerEvent.data))
        handleManagerPiEvent(
          managerEvent.sessionId,
          managerEvent.data,
          managerEvent.sequence,
        )
    }, () => {
      resetEventSequence()
      setPiConnection('connecting')
      clearActivity()
      showToast('error', 'Connection to backend lost; retrying.')
    }), [
    clearActivity,
    clearManagerUnavailableToasts,
    handleManagerPiEvent,
    refreshSessions,
    resetEventSequence,
    showToast,
  ])

  // Selected session and loading state
  const selectedSession = sessions.find((session) => session.id === selectedId)
  const selectedSessionId = selectedSession?.id
  const selectedSessionStatus = selectedSession?.status
  const sessionIsLoading = Boolean(selectedSessionId && snapshotSessionId !== selectedSessionId)

  // Manages loading overlay fade-in / fade-out around snapshot refresh.
  useEffect(() => {
    window.clearTimeout(loadingTimerRef.current)
    if (!selectedSessionId) {
      setLoadingPhase('hidden')
      return
    }
    if (sessionIsLoading) {
      setLoadingPhase('entering')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('visible'), 200)
    } else {
      setLoadingPhase('exiting')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('hidden'), 200)
    }
    return () => window.clearTimeout(loadingTimerRef.current)
  }, [selectedSessionId, sessionIsLoading])

  const displayedActivity = selectedSession?.id && compactingSessionIds.has(selectedSession.id)
    ? { kind: 'compacting' as const }
    : selectedSession
    ? sessionActivity(activity, selectedSession.status, piConnection)
    : null

  // Composer and session lifecycle
  const handleConversationError = useCallback(
    (cause: unknown) => showToast('error', messageOf(cause)),
    [showToast],
  )
  const handleComposerAgentChange = useCallback(
    (agent: string) => activateAgent(selectedId, agent),
    [activateAgent, selectedId],
  )
  /** Executes a composer command and synchronizes capabilities affected by it. */
  const handleComposerCommand = useCallback(async (command: JsonObject) => {
    const result = await sendPiCommand(selectedId, command)
    await refreshSnapshot(selectedId)
    if (command.type === 'compact') showToast('notice', 'Session compacted.')
    return result
  }, [refreshSnapshot, selectedId, showToast])
  /** Sends the current draft with the behavior supported by the active session. */
  const handleComposerSend = useCallback(
    async (
      message: string,
      images: JsonObject[],
      behavior: 'steer' | 'followUp',
      isCommand: boolean,
    ) => {
      const command: JsonObject = { type: 'prompt', message, images }
      const isSteering = !isCommand && selectedSessionStatus === 'running' && behavior === 'steer'
      if (selectedSessionStatus === 'running') command.streamingBehavior = behavior
      if (isSteering) addPendingSteering(message)
      const optimisticId = !isSteering && !isCommand ? addOptimisticUserMessage(message) : undefined
      try {
        await sendPiCommand(selectedId, command)
        const sentSession = sessions.find((session) => session.id === selectedId)
        const shouldNameSession = !isCommand && sentSession?.name === 'New session'
          && !snapshot
            .messages
            .some((entry) => entry.role === 'user')
        if (sentSession && shouldNameSession) nameSessionFromFirstPrompt(sentSession, message)
        await refreshSessions()
        setScrollToBottomRequest((current) => current + 1)
      } catch (cause) {
        if (optimisticId) removeLiveMessage(optimisticId)
        if (isSteering) removePendingSteering(message)
        throw cause
      }
    },
    [
      addOptimisticUserMessage,
      addPendingSteering,
      nameSessionFromFirstPrompt,
      refreshSessions,
      removeLiveMessage,
      removePendingSteering,
      selectedId,
      selectedSessionStatus,
      sessions,
      snapshot.messages,
    ],
  )
  const handleComposerAbort = useCallback(() => sendPiCommand(selectedId, { type: 'abort' }), [
    selectedId,
  ])
  const handlePromptImprovement = useCallback(
    (prompt: string, direction?: string) => improvePrompt(selectedId, prompt, direction),
    [selectedId],
  )
  /** Persists the draft through Pi's prompt directories and confirms its scope to the user. */
  const handleSavePrompt = useCallback(async (
    scope: 'global' | 'project',
    name: string,
    content: string,
  ) => {
    const saved = await savePrompt(selectedSession?.cwd ?? workspacePath, scope, name, content)
    showToast(
      'notice',
      `Prompt “${name}” saved ${scope === 'global' ? 'globally' : 'for this project'}.`,
    )
    return saved
  }, [selectedSession?.cwd, showToast, workspacePath])
  const handleComposerSelectOpened = useCallback(() => setRequestedSelect(null), [])
  const analysisAvailable = selectedSession !== undefined
    && snapshotSessionId === selectedSession.id
  const sessionAnalysis = useMemo(() =>
    !analysisAvailable || activeRightWidget !== 'analysis'
      ? null
      : analyzeSession(snapshot.messages, snapshot.stats, selectedSession.status === 'running', {
        requestDurations: observedRequestDurations,
        toolDurations: observedToolDurations,
        toolExecutions,
      }), [
    activeRightWidget,
    analysisAvailable,
    observedRequestDurations,
    observedToolDurations,
    selectedSession,
    snapshot.messages,
    snapshot.stats,
    toolExecutions,
  ])
  const questionnaire = dialog && isAskUserQuestionDialog(dialog.request) ? dialog : null
  const questionnaireSession = questionnaire
    ? sessions.find((session) => session.id === questionnaire.sessionId)
    : undefined
  const questionnaireInComposer = questionnaire?.sessionId === selectedId
    && snapshotSessionId === selectedId
  const openQuestionnaireSession = questionnaireSession && questionnaireSession.id !== selectedId
    ? () =>
      questionnaireSession.cwd === workspacePath
        ? setSelectedId(questionnaireSession.id)
        : selectWorkspace(questionnaireSession.cwd, questionnaireSession.id)
    : undefined

  const markComposerDraftApplied = useCallback((id: string) => {
    setComposerDraftRequest((current) => current?.id === id ? undefined : current)
  }, [])

  // Commands and keyboard shortcuts
  /** Executes a productivity command in the context of the active session. */
  const executeCommand = useCallback((id: CommandId): void => {
    const rightWidget = rightWidgetFromCommand(id)
    if (rightWidget) {
      if (
        (rightWidget === 'analysis' && !analysisAvailable)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
      ) return
      openRightWidget(rightWidget)
      return
    }
    if (id === 'open-palette') {
      setCommandPaletteOpen(true)
      return
    }
    if (id === 'open-settings') {
      setSettingsOpen(true)
      return
    }
    if (id === 'open-terminal') {
      void openTerminalAction(() => openTerminal(workspacePath, terminalCommand)).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'new-session') {
      void startAndSelectSession(() => createSession(workspacePath)).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'send') {
      setSubmitRequest((current) => current + 1)
      return
    }
    if (id === 'abort' && selectedId) {
      void sendPiCommand(selectedId, { type: 'abort' }).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'open-agent' || id === 'open-model' || id === 'open-thinking') {
      setRequestedSelect(id === 'open-agent' ? 'agent' : id === 'open-model' ? 'model' : 'thinking')
      return
    }
    if (id === 'copy-last-response') {
      const text = lastAssistantText(snapshot.messages)
      if (!text) {
        showToast('notice', 'No assistant response to copy.')
        return
      }
      void navigator
        .clipboard
        .writeText(text)
        .then(() => showToast('notice', 'Last response copied.'))
        .catch((cause) => showToast('error', messageOf(cause)))
      return
    }
    if (id === 'open-directory-picker') {
      setDirectoryPickerOpen(true)
      return
    }
    if (id === 'workspace-previous' && recentWorkspacePaths.length > 1) {
      selectWorkspace(recentWorkspacePaths[1])
      return
    }
    if (id === 'focus-composer') {
      setFocusComposerRequest((current) => current + 1)
      return
    }
    if (id === 'next-session' || id === 'previous-session') {
      const visible = sidebarSessions(recentSessions, workspacePath, sentSessions)
      const currentIndex = visible.findIndex((session) => session.id === selectedId)
      const targetIndex = id === 'next-session' ? currentIndex + 1 : currentIndex - 1
      if (targetIndex >= 0 && targetIndex < visible.length) setSelectedId(visible[targetIndex].id)
      return
    }
    if (id === 'toggle-conversation-view') {
      setConversationView((current) => {
        const next = nextConversationView(current)
        window.localStorage.setItem('pi-livecraft.conversation-view', next)
        return next
      })
      return
    }
    if (id === 'open-explorer') {
      void openFolderAction(() => openExplorer(workspacePath)).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
  }, [
    gitSnapshot?.repository,
    openRightWidget,
    recentSessions,
    recentWorkspacePaths,
    selectWorkspace,
    selectedId,
    sentSessions,
    analysisAvailable,
    setDirectoryPickerOpen,
    setSelectedId,
    showToast,
    snapshot.messages,
    startAndSelectSession,
    terminalCommand,
    workspacePath,
  ])

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const visibleIds = sidebarSessions(recentSessions, workspacePath, sentSessions).map((session) =>
      session.id
    )
    const selectedIndex = selectedId ? visibleIds.indexOf(selectedId) : -1
    return commandDefinitions.map((definition) => {
      const rightWidget = rightWidgetFromCommand(definition.id)
      const unavailableWidget = (rightWidget === 'analysis' && !analysisAvailable)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
      return {
        ...definition,
        shortcut: shortcuts[definition.id],
        disabled: unavailableWidget
          || ([
              'send',
              'abort',
              'open-thinking',
              'open-model',
              'open-agent',
              'copy-last-response',
            ] as CommandId[])
              .includes(definition.id) && !selectedSession
          || (definition.id === 'abort' && selectedSession?.status !== 'running')
          || (definition.id === 'workspace-previous' && recentWorkspacePaths.length < 2)
          || (definition.id === 'next-session'
            && (selectedIndex === -1 || selectedIndex >= visibleIds.length - 1))
          || (definition.id === 'previous-session' && selectedIndex <= 0),
        onExecute: () => executeCommand(definition.id),
      }
    })
  }, [
    executeCommand,
    gitSnapshot?.repository,
    recentSessions,
    recentWorkspacePaths,
    selectedId,
    selectedSession,
    sentSessions,
    analysisAvailable,
    shortcuts,
    workspacePath,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement && (target
          .isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        && event.key !== 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey
      ) return
      const shortcut = shortcutFromEvent(event)
      const command = (Object.entries(shortcuts) as [CommandId, string | undefined][])
        .find(([, value]) => value === shortcut)
        ?.[0]
      if (!command) return
      if (
        event.key === 'Escape' && (commandPaletteOpen || settingsOpen || dialog || document
          .querySelector(
            '[aria-modal="true"],.composer-select-content,[data-radix-select-content],.slash-commands',
          ))
      ) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, dialog, executeCommand, settingsOpen, shortcuts])

  /** Positions the conversation on the element chosen from session analysis. */
  const navigateToAnalysisTarget = useCallback((target: SessionAnalysisTarget): void => {
    if (target.kind === 'tool' || target.kind === 'turn') {
      setConversationView('detailed')
      window.localStorage.setItem('pi-livecraft.conversation-view', 'detailed')
    }
    setConversationNavigation((current) => ({ id: (current?.id ?? 0) + 1, target }))
  }, [])

  // Right sidebar composition
  /** Actions pinned to the right rail without an associated panel. */
  const railActions = useMemo(() => [
    {
      key: 'explorer',
      icon: (
        <svg aria-hidden='true' viewBox='0 0 24 24' width='18' height='18'>
          <path
            d='M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
          <path
            d='M3 9h18'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
        </svg>
      ),
      label: 'Open folder',
      onClick: () => {
        void openFolderAction(() => openExplorer(workspacePath)).catch((cause) =>
          showToast('error', messageOf(cause))
        )
      },
    },
    {
      key: 'terminal',
      icon: <span aria-hidden='true'>›_</span>,
      label: 'Open terminal',
      onClick: () => {
        void openTerminalAction(() => openTerminal(workspacePath, terminalCommand)).catch((cause) =>
          showToast('error', messageOf(cause))
        )
      },
    },
  ], [showToast, terminalCommand, workspacePath])

  // Application layout
  const rightPanelVisible = activeRightWidget === 'todo' || activeRightWidget === 'quotas'
    || (activeRightWidget === 'analysis' && sessionAnalysis !== null)
    || (activeRightWidget === 'git' && gitSnapshot?.repository === true)

  return (
    <div
      ref={appShellRef}
      className={`app-shell ${workspaceSidebarCollapsed ? 'workspace-sidebar-collapsed ' : ''}${
        rightPanelVisible ? 'right-sidebar-visible' : 'right-sidebar-collapsed'
      }`}
      data-theme={displayedTheme.mode}
      style={{
        '--right-sidebar-width': `${rightSidebarWidth}px`,
        '--workspace-sidebar-width': `${workspaceSidebarWidth}px`,
      } as CSSProperties}
    >
      <WorkspaceSidebar
        collapsed={workspaceSidebarCollapsed}
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        isRefreshing={isRefreshingSessions}
        recentSessions={recentSessions}
        sentSessions={sentSessions}
        sessions={sessions}
        selectedId={selectedId}
        width={workspaceSidebarWidth}
        workspacePath={workspacePath}
        onChooseWorkspace={() => setDirectoryPickerOpen(true)}
        onCloseSession={closeManagedSession}
        onCreate={async () => {
          await startAndSelectSession(() => createSession(workspacePath))
        }}
        onOpenSession={async (recentSession) => {
          await startAndSelectSession(() => openSession(workspacePath, recentSession.sessionPath))
        }}
        onSelectOtherWorkspaceSession={(session) => selectWorkspace(session.cwd, session.id)}
        onSelectSession={setSelectedId}
        onError={(cause) => showToast('error', messageOf(cause))}
        onOpenSettings={() => setSettingsOpen(true)}
        onRenameSession={renameManagedSession}
        onResize={updateWorkspaceSidebarWidth}
        onToggleCollapsed={toggleWorkspaceSidebar}
      />

      <main className='workspace'>
        <ManagerRuntimeNotice
          activeSession={sessions.some(({ status }) =>
            status === 'running' || status === 'starting'
          )}
          status={managerRuntimeStatus}
          onError={(cause) => showToast('error', messageOf(cause))}
          onRestart={restartManager}
        />
        {selectedSession
          ? (
            <>
              {(snapshotSessionId === selectedSession.id || loadingPhase === 'exiting') && (
                <>
                  <Conversation
                    activity={displayedActivity}
                    agentName={selectedSession.activeAgent}
                    conversationView={conversationView}
                    key={selectedSession.id}
                    liveMessages={liveMessages}
                    messages={snapshot.messages}
                    navigationRequest={conversationNavigation}
                    onError={handleConversationError}
                    pendingSteering={pendingSteering}
                    repositoryRoot={gitSnapshot?.root}
                    scrollToBottomRequest={scrollToBottomRequest}
                    workingDirectory={selectedSession.cwd}
                    toolExecutions={toolExecutions}
                  />
                  <div className={`chat-detail-control ${conversationView}`}>
                    <button
                      aria-label={`${conversationViewDetail.label}. ${conversationViewDetail.description}. Hover or focus to choose another view.`}
                      className={`chat-detail-toggle ${conversationView}`}
                      onClick={() =>
                        setConversationView((current) => {
                          const next = nextConversationView(current)
                          window.localStorage.setItem('pi-livecraft.conversation-view', next)
                          return next
                        })}
                      type='button'
                    >
                      <span aria-hidden='true' className='chat-detail-toggle-icon'>⌘</span>
                      <span className='chat-detail-toggle-copy'>
                        <strong>{conversationViewDetail.label}</strong>
                        <small>{conversationViewDetail.description}</small>
                      </span>
                    </button>
                    <div
                      aria-label='Conversation view options'
                      className='chat-detail-view-menu'
                      role='group'
                    >
                      {(['simple', 'semi-detailed', 'detailed'] as const).map((view) => {
                        const detail = conversationViewDetails[view]
                        return (
                          <button
                            aria-pressed={view === conversationView}
                            className={`chat-detail-option ${view}${
                              view === conversationView ? ' selected' : ''
                            }`}
                            key={view}
                            onClick={() => {
                              setConversationView(view)
                              window.localStorage.setItem('pi-livecraft.conversation-view', view)
                            }}
                            type='button'
                          >
                            <span aria-hidden='true' className='chat-detail-option-mark' />
                            <span className='chat-detail-option-copy'>
                              <strong>{detail.label}</strong>
                              <small>{detail.description}</small>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className='composer-area'>
                    {questionnaire && questionnaireInComposer && (
                      <AskUserQuestionDialog
                        canMinimize
                        dialog={questionnaire}
                        key={String(
                          questionnaire
                            .request
                            .id,
                        )}
                        sessionName={selectedSession.name}
                        onClose={() => closeDialog(questionnaire)}
                        onError={(cause) => showToast('error', messageOf(cause))}
                      />
                    )}
                    <ToastStack onDismiss={dismissToast} toasts={visibleToasts} />
                    <Composer
                      key={selectedSession.id}
                      session={selectedSession}
                      snapshot={snapshot}
                      agentBusy={Boolean(agentBusy[selectedSession.id])}
                      agentOptions={agentOptions[selectedSession.id] ?? emptyAgentOptions}
                      agentOptionsLoading={Boolean(agentOptionsLoading[selectedSession.id])}
                      selectedAgent={selectedSession.activeAgent ?? ''}
                      onAgentChange={handleComposerAgentChange}
                      onRequestAgentOptions={() => fetchAgentOptions(selectedSession.id)}
                      onCommand={handleComposerCommand}
                      commands={snapshot.commands}
                      agentLoading={snapshotSessionId !== selectedSession.id}
                      focusRequest={focusComposerRequest}
                      draftRequest={composerDraftRequest?.sessionId === selectedSession.id
                        ? composerDraftRequest
                        : undefined}
                      onDraftApplied={markComposerDraftApplied}
                      showAgentSelector={snapshotSessionId !== selectedSession.id
                        || snapshot.commands.some((command) => command.name === 'agent')}
                      running={selectedSession.status === 'running'}
                      compacting={displayedActivity?.kind === 'compacting'}
                      onSend={handleComposerSend}
                      onAbort={handleComposerAbort}
                      onImprovePrompt={handlePromptImprovement}
                      onSavePrompt={handleSavePrompt}
                      onError={handleConversationError}
                      requestedSelect={requestedSelect}
                      onSelectOpened={handleComposerSelectOpened}
                      submitRequest={submitRequest}
                    />
                  </div>
                </>
              )}
              {loadingPhase !== 'hidden' && (
                <>
                  <section
                    aria-busy={loadingPhase !== 'exiting' ? true : undefined}
                    aria-live={loadingPhase !== 'exiting' ? 'polite' : undefined}
                    className={`welcome session-loading session-loading-${loadingPhase}`}
                  >
                    <span className='brand-mark large brand-mark-loading'>π</span>
                    <h1>Connecting to Pi…</h1>
                    <p>Loading the session and its capabilities.</p>
                    <span aria-hidden='true' className='session-loading-indicator' />
                  </section>
                  {loadingPhase !== 'exiting' && (
                    <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
                  )}
                </>
              )}
            </>
          )
          : creatingSession
          ? (
            <>
              <section className='welcome' aria-busy='true'>
                <span className='brand-mark large brand-mark-loading'>π</span>
                <h1>Starting new session…</h1>
                <p>Initializing Pi and its agents.</p>
                <span aria-hidden='true' className='session-loading-indicator' />
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )
          : (
            <>
              <section className='welcome'>
                <span className='brand-mark large'>π</span>
                <h1>Control Pi from your browser</h1>
                <p>Create a local session to access your models, agents, tools, and commands.</p>
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )}
      </main>

      <RightSidebar
        activeSessionId={selectedId}
        activeWidget={activeRightWidget}
        analysis={sessionAnalysis}
        analysisAvailable={analysisAvailable}
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        currentQuotaProvider={currentQuotaProvider}
        onAnalysisNavigate={navigateToAnalysisTarget}
        onResize={updateRightSidebarWidth}
        snapshot={gitSnapshot?.repository ? gitSnapshot : null}
        sessions={sessions}
        quotas={quotas}
        width={rightSidebarWidth}
        workspacePath={workspacePath}
        railActions={railActions}
        onCommit={async (message) => {
          await commitChanges(workspacePath, message)
        }}
        onDiscard={async (path) => {
          await discardChanges(workspacePath, path)
        }}
        onPush={() => pushCommits(workspacePath)}
        onFileSelect={(path, commitHash) => getGitFileDiff(workspacePath, path, commitHash)}
        onQuotaRefresh={() => refreshSessionQuotas(selectedId, false)}
        onRefresh={() => refreshGit(workspacePath, true)}
        onReset={async (hash) => {
          return await resetGitCommit(workspacePath, hash)
        }}
        onRevert={async (hash) => {
          return await revertGitCommit(workspacePath, hash)
        }}
        onTodoNavigateSession={(link) => {
          const active = sessions.find((s) => s.id === link.id)
          if (active) {
            setSelectedId(link.id)
          } else {
            void startAndSelectSession(() => openSession(workspacePath, link.sessionPath))
          }
        }}
        onTodoSendPrompt={async (message) =>
          startAndSelectSession(() => createSession(workspacePath), message)}
        onTodoStartSession={async (message) =>
          startAndSelectSession(() => createSession(workspacePath), undefined, message)}
        onWidgetSelect={(widget) =>
          setActiveRightWidget((current) => {
            const next = current === widget ? null : widget
            window.localStorage.setItem('pi-livecraft.right-sidebar-widget', next ?? 'none')
            return next
          })}
      />

      {directoryPickerOpen && (
        <DirectoryPicker
          initialPath={workspacePath}
          recentPaths={recentWorkspacePaths}
          onClose={() => setDirectoryPickerOpen(false)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onSelect={selectWorkspace}
        />
      )}
      {questionnaire && !questionnaireInComposer && (
        <AskUserQuestionDialog
          canMinimize={false}
          key={String(
            questionnaire
              .request
              .id,
          )}
          dialog={questionnaire}
          sessionName={questionnaireSession?.name}
          onClose={() => closeDialog(questionnaire)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onOpenSession={openQuestionnaireSession}
        />
      )}
      {dialog && !questionnaire && (
        <ExtensionDialog
          dialog={dialog}
          onClose={() => closeDialog(dialog)}
          onError={(cause) => showToast('error', messageOf(cause))}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          backendBaseUrl={backendBaseUrl}
          definitions={commandDefinitions}
          shortcuts={shortcuts}
          terminalCommand={terminalCommand}
          themes={allThemes(themePreferences)}
          activeThemeId={activeTheme.id}
          onBackendBaseUrlChange={(value) => {
            const normalized = persistBackendBaseUrl(value)
            setBackendBaseUrl(normalized)
          }}
          onBackendBaseUrlReset={() => {
            resetBackendBaseUrl()
            setBackendBaseUrl(readBackendBaseUrl())
          }}
          onPreviewTheme={setThemePreview}
          onChange={(id, shortcut) => {
            const next = { ...shortcuts, [id]: shortcut }
            setShortcuts(next)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(next))
          }}
          onTerminalCommandChange={(value) => {
            setTerminalCommand(value)
            window.localStorage.setItem('pi-livecraft.terminal-command', value)
          }}
          onSelectTheme={selectTheme}
          onDuplicateTheme={duplicateActiveTheme}
          onRenameTheme={renameSelectedTheme}
          onUpdateThemeColor={updateSelectedThemeColor}
          onDeleteTheme={deleteSelectedTheme}
          onResetTheme={resetSelectedTheme}
          onReset={() => {
            setShortcuts(defaultShortcuts)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(defaultShortcuts))
          }}
          onClose={() => {
            setThemePreview(undefined)
            setSettingsOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Lit une éventuelle ancienne liste invalide sans empêcher l'ouverture de l'application. */
function readShortcuts(): Partial<Record<CommandId, string>> {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('pi-livecraft.shortcuts') ?? 'null',
    )
    if (!isObject(value)) return defaultShortcuts
    const primaryModifier = navigator.platform.toLowerCase().includes('mac') ? 'meta' : 'ctrl'
    const stored = Object
      .entries(value)
      .filter(([key, shortcut]) =>
        key !== 'send' && commandDefinitions.some((definition) => definition.id === key)
        && typeof shortcut === 'string'
      )
      .map(([key, shortcut]) => [key, migrateLegacyShortcut(shortcut as string, primaryModifier)])
    return { ...defaultShortcuts, ...Object.fromEntries(stored) } as Partial<
      Record<CommandId, string>
    >
  } catch {
    return defaultShortcuts
  }
}

function readTerminalCommand(): string {
  const stored = window.localStorage.getItem('pi-livecraft.terminal-command')
  return stored && stored.trim() && stored.includes('{cwd}') ? stored : ''
}

/** Restores the last-selected right sidebar widget, falling back to git when not collapsed. */
function readActiveRightWidget(): RightWidget | null {
  const stored = window.localStorage.getItem('pi-livecraft.right-sidebar-widget')
  if (isRightWidget(stored)) return stored
  if (stored === 'none') return null
  return window.localStorage.getItem('pi-livecraft.git-sidebar-collapsed') === 'true' ? null : 'git'
}

function isManagerRuntimeStatus(value: unknown): value is ManagerRuntimeStatus {
  if (!isObject(value) || typeof value.canRestart !== 'boolean' || typeof value.state !== 'string')
    return false
  return value.state === 'checking' || value.state === 'current' || value.state === 'stale' || value
        .state === 'restarting'
    || value.state === 'disconnected' || value.state === 'unknown'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default App
