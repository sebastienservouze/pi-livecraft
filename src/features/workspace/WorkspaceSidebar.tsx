import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { SessionSummary } from '../../../shared/types.ts'
import { defaultWorkerName } from '../../../shared/session-names.ts'
import { displayThreadTitle } from '../composer/prompt-title.ts'
import { sessionIndicator, type SessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import type { ProjectGroup, ProjectThread } from './sidebar-projects.ts'
import { maxWorkspaceSidebarWidth, minWorkspaceSidebarWidth } from './workspace-sidebar.ts'

interface WorkspaceSidebarProps {
  collapsed: boolean
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  isRefreshing: boolean
  projects: ProjectGroup[]
  sessions: SessionSummary[]
  selectedId: string
  width: number
  activeWorkspacePath: string
  archivedProjects: string[]
  onToggleCollapsed: () => void
  onChooseProject: () => void
  onCreateThread: (projectPath: string) => Promise<void>
  onActivateThread: (thread: ProjectThread) => Promise<void>
  onTogglePin: (projectPath: string) => void
  onArchiveProject: (projectPath: string) => void
  onUnarchiveProject: (projectPath: string) => void
  onOpenProjectFolder: (projectPath: string) => void
  onOpenSettings: () => void
  onResize: (width: number) => void
  onError: (cause: unknown) => void
}

/** Displays project-grouped Pi sessions, an explicit project picker, and per-project actions. */
export function WorkspaceSidebar({
  collapsed,
  compactingSessionIds,
  completedSessionIds,
  isRefreshing,
  projects,
  sessions,
  selectedId,
  width,
  activeWorkspacePath,
  archivedProjects,
  onToggleCollapsed,
  onChooseProject,
  onCreateThread,
  onActivateThread,
  onTogglePin,
  onArchiveProject,
  onUnarchiveProject,
  onOpenProjectFolder,
  onOpenSettings,
  onResize,
  onError,
}: WorkspaceSidebarProps) {
  const selectedThreadRef = useRef<HTMLButtonElement>(null)
  const totalThreads = useMemo(
    () => projects.reduce((count, project) => count + project.threads.length, 0),
    [projects],
  )

  useEffect(() => {
    selectedThreadRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, projects])

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + moveEvent.clientX - initialX)
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
    const adjustment = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minWorkspaceSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxWorkspaceSidebarWidth)
    }
  }

  if (collapsed) {
    return (
      <aside className='sidebar sidebar-rail' aria-label='Collapsed session sidebar'>
        <Tooltip label='Expand sidebar (⌘B)'>
          <button
            aria-expanded={false}
            aria-label='Expand sidebar'
            className='sidebar-rail-button brand-mark'
            onClick={onToggleCollapsed}
            type='button'
          >
            π
          </button>
        </Tooltip>
        <Tooltip label='New thread'>
          <button
            aria-label='New thread'
            className='sidebar-rail-button'
            onClick={() => void onCreateThread(activeWorkspacePath).catch(onError)}
            type='button'
          >
            <PlusIcon />
          </button>
        </Tooltip>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='sidebar-rail-button'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
      </aside>
    )
  }

  return (
    <aside className='sidebar'>
      <div
        aria-label='Resize session sidebar'
        aria-orientation='vertical'
        aria-valuemax={maxWorkspaceSidebarWidth}
        aria-valuemin={minWorkspaceSidebarWidth}
        aria-valuenow={width}
        className='sidebar-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='brand'>
        <Tooltip label='Collapse sidebar (⌘B)'>
          <button
            aria-expanded
            aria-label='Collapse sidebar'
            className='settings-button'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon />
          </button>
        </Tooltip>
        <div>
          <strong>Pi Livecraft</strong>
          <small>Project sessions</small>
        </div>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='settings-button'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
      </div>

      <div className='workspace-group'>
        <Tooltip label={activeWorkspacePath}>
          <button
            aria-label={`Change project. Current: ${activeWorkspacePath}`}
            className='workspace-path'
            onClick={onChooseProject}
            type='button'
          >
            <WorkspaceIcon />
            <div className='workspace-path-copy'>
              <span>Project</span>
              <strong>{activeWorkspacePath}</strong>
            </div>
            <ChevronIcon />
          </button>
        </Tooltip>
      </div>

      <NewThreadButton
        onCreate={() => onCreateThread(activeWorkspacePath)}
        onError={onError}
      />

      <div className='project-list' aria-label='Projects and their Pi sessions'>
        {isRefreshing && totalThreads === 0 && (
          <p className='session-list-loading' role='status'>Loading sessions…</p>
        )}
        {projects.map((project) => (
          <ProjectSection
            key={project.path}
            project={project}
            sessions={sessions}
            selectedId={selectedId}
            selectedThreadRef={selectedThreadRef}
            compactingSessionIds={compactingSessionIds}
            completedSessionIds={completedSessionIds}
            onCreateThread={onCreateThread}
            onActivateThread={onActivateThread}
            onTogglePin={onTogglePin}
            onArchiveProject={onArchiveProject}
            onOpenProjectFolder={onOpenProjectFolder}
            onError={onError}
          />
        ))}
        {!isRefreshing && totalThreads === 0 && (
          <p className='empty-sidebar'>No Pi sessions yet. Start a new thread above.</p>
        )}
      </div>

      {archivedProjects.length > 0 && (
        <details className='archived-projects'>
          <summary>Archived projects ({archivedProjects.length})</summary>
          <ul>
            {archivedProjects.map((path) => (
              <li key={path}>
                <span className='archived-project-path' title={path}>{path}</span>
                <button
                  aria-label={`Restore archived project ${path}`}
                  onClick={() => onUnarchiveProject(path)}
                  type='button'
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  )
}

interface ProjectSectionProps {
  project: ProjectGroup
  sessions: SessionSummary[]
  selectedId: string
  selectedThreadRef: React.RefObject<HTMLButtonElement | null>
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  onCreateThread: (projectPath: string) => Promise<void>
  onActivateThread: (thread: ProjectThread) => Promise<void>
  onTogglePin: (projectPath: string) => void
  onArchiveProject: (projectPath: string) => void
  onOpenProjectFolder: (projectPath: string) => void
  onError: (cause: unknown) => void
}

/** Renders a project divider with scoped actions and the project's ordered threads. */
function ProjectSection({
  project,
  sessions,
  selectedId,
  selectedThreadRef,
  compactingSessionIds,
  completedSessionIds,
  onCreateThread,
  onActivateThread,
  onTogglePin,
  onArchiveProject,
  onOpenProjectFolder,
  onError,
}: ProjectSectionProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const summary = project.activeCount > 0
    ? `${project.threads.length} threads · ${project.activeCount} active`
    : `${project.threads.length} thread${project.threads.length === 1 ? '' : 's'}`

  return (
    <section className='project-section' aria-label={`Project ${project.label}`}>
      <div className='project-divider'>
        <div className='project-divider-copy'>
          <Tooltip label={project.path}>
            <h2>
              {project.pinned && <span aria-hidden='true' className='project-pin-mark'>📌</span>}
              {project.label}
            </h2>
          </Tooltip>
          <small>{summary}</small>
        </div>
        <div className='project-actions'>
          <Tooltip label={`New thread in ${project.label}`}>
            <button
              aria-label={`New thread in ${project.label}`}
              className='project-action'
              onClick={() => void onCreateThread(project.path).catch(onError)}
              type='button'
            >
              <PlusIcon />
            </button>
          </Tooltip>
          <Tooltip label={project.pinned ? 'Unpin project' : 'Pin project'}>
            <button
              aria-label={project.pinned ? `Unpin ${project.label}` : `Pin ${project.label}`}
              aria-pressed={project.pinned}
              className='project-action'
              onClick={() => onTogglePin(project.path)}
              type='button'
            >
              <PinIcon />
            </button>
          </Tooltip>
          <Tooltip label={`Archive ${project.label}`}>
            <button
              aria-label={`Archive ${project.label}`}
              className='project-action'
              onClick={() => onArchiveProject(project.path)}
              type='button'
            >
              <ArchiveIcon />
            </button>
          </Tooltip>
          <div className='project-overflow'>
            <button
              aria-expanded={overflowOpen}
              aria-haspopup='menu'
              aria-label={`More actions for ${project.label}`}
              className='project-action'
              onClick={() => setOverflowOpen((open) => !open)}
              onBlur={(event) => {
                if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node))
                  setOverflowOpen(false)
              }}
              type='button'
            >
              <OverflowIcon />
            </button>
            {overflowOpen && (
              <div className='project-overflow-menu' role='menu'>
                <button
                  className='project-overflow-item'
                  onClick={() => {
                    setOverflowOpen(false)
                    onOpenProjectFolder(project.path)
                  }}
                  role='menuitem'
                  type='button'
                >
                  Open folder
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className='session-list project-threads' aria-label={`${project.label} sessions`}>
        {project.threads.length === 0 && <p className='project-empty'>No threads yet.</p>}
        {project.threads.map((thread) => {
          const active = sessions.find((session) =>
            (thread.sessionPath
              ? session.sessionPath === thread.sessionPath
              : session.id === thread.id) && session.status !== 'exited'
          )
          const indicator = sessionIndicator(
            active,
            selectedId,
            compactingSessionIds,
            completedSessionIds,
          )
          const isSelected = active?.id === selectedId
          const worker = active?.activeAgent ?? thread.worker ?? defaultWorkerName
          const title = displayThreadTitle(thread.name, worker)
          return (
            <ThreadItem
              key={thread.key}
              indicator={indicator}
              isSelected={isSelected}
              selectedThreadRef={isSelected ? selectedThreadRef : undefined}
              thread={thread}
              title={title}
              onActivate={onActivateThread}
              onError={onError}
            />
          )
        })}
      </nav>
    </section>
  )
}

interface ThreadItemProps {
  indicator: SessionIndicator | null
  isSelected: boolean
  selectedThreadRef?: React.RefObject<HTMLButtonElement | null>
  thread: ProjectThread
  title: string
  onActivate: (thread: ProjectThread) => Promise<void>
  onError: (cause: unknown) => void
}

/** A single selectable thread; shows a transient opening state while a history thread resumes. */
function ThreadItem(
  { indicator, isSelected, selectedThreadRef, thread, title, onActivate, onError }: ThreadItemProps,
) {
  const [opening, setOpening] = useState(false)
  return (
    <Tooltip label={title}>
      <button
        className={`session-item${isSelected ? ' selected' : ''}${
          indicator ? ` ${indicator}` : ''
        }`}
        disabled={opening}
        onClick={() => {
          setOpening(true)
          void onActivate(thread).catch(onError).finally(() => setOpening(false))
        }}
        ref={selectedThreadRef}
        type='button'
      >
        {indicator && <SessionStatusIndicator status={indicator} />}
        <span>
          <strong>{opening ? 'Opening…' : title}</strong>
        </span>
      </button>
    </Tooltip>
  )
}

/** Prevents duplicate thread creation and reports errors to the container. */
function NewThreadButton(
  { onCreate, onError }: { onCreate: () => Promise<void>; onError: (cause: unknown) => void },
) {
  const [busy, setBusy] = useState(false)

  async function create(): Promise<void> {
    setBusy(true)
    try {
      await onCreate()
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className='new-session'
      disabled={busy}
      onClick={() => void create()}
      type='button'
    >
      {busy ? 'Starting…' : '＋ New thread'}
    </button>
  )
}

function WorkspaceIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8A1.5 1.5 0 0 1 20.5 8.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z' />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='m9 6 6 6-6 6' />
    </svg>
  )
}

function SidebarToggleIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='16'
    >
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M9 4v16' />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.8'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 5v14M5 12h14' />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 16v4' />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='16'
    >
      <rect x='3' y='4' width='18' height='4' rx='1' />
      <path d='M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4' />
    </svg>
  )
}

function OverflowIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='currentColor'
      height='16'
      viewBox='0 0 24 24'
      width='16'
    >
      <circle cx='5' cy='12' r='1.6' />
      <circle cx='12' cy='12' r='1.6' />
      <circle cx='19' cy='12' r='1.6' />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
      <path d='m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z' />
    </svg>
  )
}
