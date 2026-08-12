import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  GitFileDiff,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  QuotaSnapshot,
  SessionSummary,
} from '../../../shared/types.ts'
import { ExplorerPanel } from '../explorer/ExplorerPanel.tsx'
import { GitWidget } from '../git/GitWidget.tsx'
import { QuotaWidget } from '../quotas/QuotaWidget.tsx'
import { railQuota, type QuotaProvider } from '../quotas/quota-display.ts'
import { SessionAnalysisWidget } from '../session-analysis/SessionAnalysisWidget.tsx'
import type {
  SessionAnalysis,
  SessionAnalysisTarget,
} from '../session-analysis/session-analysis.ts'
import { ShellPanel } from '../shell/ShellPanel.tsx'
import { TodoWidget } from '../todo/TodoWidget.tsx'
import { loadTodos } from '../todo/todo-cache.ts'
import { maxRightSidebarWidth, minRightSidebarWidth, type RightWidget } from './right-sidebar.ts'
import { WidgetLayout } from './WidgetLayout.tsx'

/** Coordinates the sidebar panels, their common rail, and resizing. */
export function RightSidebar({
  activeSessionId,
  activeWidget,
  analysis,
  analysisAvailable,
  compactingSessionIds,
  completedSessionIds,
  currentQuotaProvider,
  onAnalysisNavigate,
  onResize,
  snapshot,
  quotas,
  width,
  workspacePath,
  onCommit,
  onDiscard,
  onFileSelect,
  onPanelError,
  onPush,
  onQuotaRefresh,
  onRefresh,
  onReset,
  onRevert,
  onTodoNavigateSession,
  onTodoSendPrompt,
  onTodoStartSession,
  onWidgetSelect,
  sessions,
}: {
  activeSessionId: string
  activeWidget: RightWidget | null
  analysis: SessionAnalysis | null
  analysisAvailable: boolean
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  currentQuotaProvider: QuotaProvider | undefined
  onAnalysisNavigate: (target: SessionAnalysisTarget) => void
  onResize: (width: number) => void
  snapshot: GitSnapshot | null
  quotas: QuotaSnapshot | null
  width: number
  workspacePath: string
  onCommit: (message: string) => Promise<void>
  onDiscard: (path?: string) => Promise<void>
  onFileSelect: (path: string, commitHash?: string) => Promise<GitFileDiff>
  onPanelError: (message: string) => void
  onPush: () => Promise<GitPushResult>
  onQuotaRefresh: () => Promise<void>
  onRefresh: () => Promise<void>
  onReset: (hash: string) => Promise<GitResetResult>
  onRevert: (hash: string) => Promise<GitRevertResult>
  onTodoNavigateSession: (link: { id: string; sessionPath: string }) => void
  onTodoSendPrompt: (message: string) => Promise<SessionSummary | null>
  onTodoStartSession: (message: string) => Promise<SessionSummary | null>
  onWidgetSelect: (widget: RightWidget) => void
  sessions: SessionSummary[]
}) {
  const [todoOpenCount, setTodoOpenCount] = useState<number | null>(null)
  const hasChanges = snapshot ? snapshot.files.length > 0 : false

  useEffect(() => {
    if (activeWidget === 'todo') return
    let cancelled = false
    setTodoOpenCount(null)
    void loadTodos(workspacePath)
      .then((todos) => {
        if (!cancelled) setTodoOpenCount(todos.filter((todo) => !todo.completed).length)
      })
      .catch(() => {
        if (!cancelled) setTodoOpenCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeWidget, workspacePath])
  const collapsed = activeWidget === null || (activeWidget === 'analysis' && !analysis)
    || (activeWidget === 'git' && !snapshot)
  const quotaSummary = railQuota(quotas, currentQuotaProvider)

  /** Installs temporary listeners needed for panel pointer resizing. */
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + initialX - moveEvent.clientX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minRightSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxRightSidebarWidth)
    }
  }

  return (
    <aside className='right-sidebar' aria-label='Workspace tools'>
      {!collapsed && (
        <div className='right-sidebar-panel'>
          <div
            aria-controls={activeWidget ? `${activeWidget}-panel` : undefined}
            aria-label='Resize sidebar panel'
            aria-orientation='vertical'
            aria-valuemax={maxRightSidebarWidth}
            aria-valuemin={minRightSidebarWidth}
            aria-valuenow={width}
            className='right-sidebar-resize-handle'
            onKeyDown={resizeWithKeyboard}
            onPointerDown={startResize}
            role='separator'
            tabIndex={0}
          />
          <section
            aria-label={panelLabel(activeWidget)}
            className='right-sidebar-content'
            id={`${activeWidget}-panel`}
            key={activeWidget ?? 'empty'}
          >
            {activeWidget === 'analysis' && analysis && (
              <WidgetLayout
                header={
                  <div>
                    <strong>Session analysis</strong>
                    <span>
                      {analysis
                        .requests
                        .length} request{analysis
                          .requests
                          .length > 1
                        ? 's'
                        : ''} analyzed
                    </span>
                  </div>
                }
              >
                <SessionAnalysisWidget
                  analysis={analysis}
                  onNavigate={onAnalysisNavigate}
                  sessionId={activeSessionId}
                />
              </WidgetLayout>
            )}
            {activeWidget === 'git' && snapshot && (
              <GitWidget
                onCommit={onCommit}
                onDiscard={onDiscard}
                onFileSelect={onFileSelect}
                onPush={onPush}
                onRefresh={onRefresh}
                onReset={onReset}
                onRevert={onRevert}
                snapshot={snapshot}
              />
            )}
            {activeWidget === 'explorer' && (
              <ExplorerPanel onError={onPanelError} workspacePath={workspacePath} />
            )}
            {activeWidget === 'quotas' && (
              <QuotaWidget onRefresh={onQuotaRefresh} quotas={quotas} />
            )}
            {activeWidget === 'shell' && (
              <ShellPanel onError={onPanelError} workspacePath={workspacePath} />
            )}
            {activeWidget === 'todo' && (
              <TodoWidget
                activeSessionId={activeSessionId}
                compactingSessionIds={compactingSessionIds}
                completedSessionIds={completedSessionIds}
                onNavigateSession={onTodoNavigateSession}
                onOpenCountChange={setTodoOpenCount}
                onSendPrompt={onTodoSendPrompt}
                onStartSession={onTodoStartSession}
                sessions={sessions}
                workspacePath={workspacePath}
              />
            )}
          </section>
        </div>
      )}
      <div className='right-sidebar-rail'>
        {analysisAvailable && (
          <Tooltip label='Session analysis'>
            <button
              aria-controls={activeWidget === 'analysis' ? 'analysis-panel' : undefined}
              aria-expanded={activeWidget === 'analysis'}
              aria-label={activeWidget === 'analysis'
                ? 'Collapse session analysis'
                : 'Expand session analysis'}
              className='rail-tab'
              onClick={() => onWidgetSelect('analysis')}
              type='button'
            >
              <span aria-hidden='true'>∑</span>
              {analysis && analysis.failedToolCalls > 0 && (
                <small>{analysis.failedToolCalls}</small>
              )}
            </button>
          </Tooltip>
        )}
        {snapshot && (
          <Tooltip label='Git'>
            <button
              aria-controls={activeWidget === 'git' ? 'git-panel' : undefined}
              aria-expanded={activeWidget === 'git'}
              aria-label={activeWidget === 'git' ? 'Collapse Git panel' : 'Expand Git panel'}
              className='rail-tab'
              onClick={() => onWidgetSelect('git')}
              type='button'
            >
              <span aria-hidden='true'>⎇</span>
              {(hasChanges || snapshot.ahead > 0) && (
                <small>{snapshot.files.length + snapshot.ahead}</small>
              )}
            </button>
          </Tooltip>
        )}
        <Tooltip label='Files'>
          <button
            aria-controls={activeWidget === 'explorer' ? 'explorer-panel' : undefined}
            aria-expanded={activeWidget === 'explorer'}
            aria-label={activeWidget === 'explorer'
              ? 'Collapse the file browser'
              : 'Expand the file browser'}
            className='rail-tab'
            onClick={() => onWidgetSelect('explorer')}
            type='button'
          >
            <span aria-hidden='true'>🗀</span>
          </button>
        </Tooltip>
        <Tooltip label='Terminal'>
          <button
            aria-controls={activeWidget === 'shell' ? 'shell-panel' : undefined}
            aria-expanded={activeWidget === 'shell'}
            aria-label={activeWidget === 'shell' ? 'Collapse the terminal' : 'Expand the terminal'}
            className='rail-tab'
            onClick={() => onWidgetSelect('shell')}
            type='button'
          >
            <span aria-hidden='true'>❯_</span>
          </button>
        </Tooltip>
        <Tooltip label={quotaSummary?.label ?? 'Quotas'}>
          <button
            aria-controls={activeWidget === 'quotas' ? 'quotas-panel' : undefined}
            aria-expanded={activeWidget === 'quotas'}
            aria-label={`${activeWidget === 'quotas' ? 'Collapse' : 'Expand'} quota panel${
              quotaSummary ? `. ${quotaSummary.label}` : ''
            }`}
            className='rail-tab'
            onClick={() => onWidgetSelect('quotas')}
            type='button'
          >
            <span aria-hidden='true' className='quota-rail-value'>
              {quotaSummary?.value ?? '%'}
            </span>
            {quotaSummary?.stale && <small>!</small>}
          </button>
        </Tooltip>
        <Tooltip label='Todo'>
          <button
            aria-controls={activeWidget === 'todo' ? 'todo-panel' : undefined}
            aria-expanded={activeWidget === 'todo'}
            aria-label={activeWidget === 'todo'
              ? 'Collapse the task panel'
              : 'Expand the task panel'}
            className='rail-tab'
            onClick={() => onWidgetSelect('todo')}
            type='button'
          >
            <span aria-hidden='true'>☑</span>
            {todoOpenCount !== null && todoOpenCount > 0 && (
              <small aria-label={`${todoOpenCount} tasks remaining`}>{todoOpenCount}</small>
            )}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}

function panelLabel(activeWidget: RightWidget | null): string {
  return activeWidget === 'analysis'
    ? 'Session analysis'
    : activeWidget === 'explorer'
    ? 'Workspace files'
    : activeWidget === 'shell'
    ? 'Workspace terminal'
    : activeWidget === 'todo'
    ? 'Workspace tasks'
    : activeWidget === 'quotas'
    ? 'Provider quotas'
    : 'Git information'
}
