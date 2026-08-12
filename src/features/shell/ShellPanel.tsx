import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  closeShellSession,
  createShellSession,
  sendShellInput,
  subscribeShellOutput,
} from '../../api.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'
import {
  cachedShellSession,
  forgetShellSession,
  rememberShellSession,
} from './shell-session-store.ts'
import { terminalLines } from './terminal-output.ts'

type ShellStatus = 'connecting' | 'ready' | 'exited' | 'error'

/** Runs a shell on the backend host and renders it in the panel, without any desktop application. */
export function ShellPanel(
  { workspacePath, onError }: { workspacePath: string; onError: (message: string) => void },
) {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<ShellStatus>('connecting')
  const [shell, setShell] = useState('')
  const [draft, setDraft] = useState('')
  const [restartCount, setRestartCount] = useState(0)
  const history = useRef<string[]>([])
  const historyIndex = useRef<number | null>(null)
  const sessionId = useRef<string | null>(null)
  const view = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe = (): void => {}
    setOutput('')
    setStatus('connecting')
    sessionId.current = null

    void (async () => {
      try {
        const reusable = cachedShellSession(workspacePath)
        if (!reusable) {
          const stale = forgetShellSession()
          if (stale) await closeShellSession(stale.id).catch(() => {})
        }
        const session = reusable ?? rememberShellSession(await createShellSession(workspacePath))
        if (cancelled) return
        sessionId.current = session.id
        setShell(session.shell)
        setStatus('ready')
        unsubscribe = subscribeShellOutput(
          session.id,
          (chunk) => {
            if (chunk.chunk) setOutput((current) => current + chunk.chunk)
            if (chunk.exited) setStatus('exited')
          },
          () => setStatus('error'),
        )
      } catch (cause) {
        if (cancelled) return
        setStatus('error')
        onError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [onError, restartCount, workspacePath])

  useEffect(() => {
    const element = view.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output])

  /** Sends raw bytes, so control characters reach the shell exactly as typed. */
  function send(data: string): void {
    const id = sessionId.current
    if (!id || status !== 'ready') return
    void sendShellInput(id, data).catch((cause) =>
      onError(cause instanceof Error ? cause.message : String(cause))
    )
  }

  function submit(): void {
    send(`${draft}\n`)
    if (draft.trim()) history.current = [...history.current, draft].slice(-100)
    historyIndex.current = null
    setDraft('')
  }

  function restart(): void {
    const stale = forgetShellSession()
    if (stale) void closeShellSession(stale.id).catch(() => {})
    setRestartCount((count) => count + 1)
  }

  /** Recalls a previously sent line; the shell keeps its own history for its own keys. */
  function recall(direction: -1 | 1): void {
    const entries = history.current
    if (entries.length === 0) return
    const position = historyIndex.current ?? entries.length
    const next = Math.min(entries.length, Math.max(0, position + direction))
    historyIndex.current = next
    setDraft(next === entries.length ? '' : entries[next])
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      recall(event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (event.ctrlKey && (event.key === 'c' || event.key === 'd' || event.key === 'l')) {
      event.preventDefault()
      send(event.key === 'c' ? '\u0003' : event.key === 'd' ? '\u0004' : '\u000c')
      if (event.key === 'c') setDraft('')
    }
  }

  return (
    <WidgetLayout
      header={
        <>
          <div>
            <strong>Terminal</strong>
            <span>{statusLabel(status, shell)}</span>
          </div>
          <div className='shell-actions'>
            <Tooltip label='Interrupt (Ctrl+C)'>
              <button
                aria-label='Interrupt the running command'
                disabled={status !== 'ready'}
                onClick={() => send('\u0003')}
                type='button'
              >
                ⌃C
              </button>
            </Tooltip>
            <Tooltip label={status === 'ready' ? 'Restart shell' : 'Start a new shell'}>
              <button aria-label='Restart the shell' onClick={restart} type='button'>↻</button>
            </Tooltip>
          </div>
        </>
      }
      footer={
        <form
          className='shell-input'
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <span aria-hidden='true'>❯</span>
          <input
            aria-label='Terminal input'
            autoComplete='off'
            disabled={status !== 'ready'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={status === 'ready' ? 'Type a command' : 'Shell unavailable'}
            spellCheck={false}
            value={draft}
          />
        </form>
      }
    >
      <div className='shell-output' ref={view} role='log' tabIndex={0}>
        {output === '' && status === 'connecting' && <p className='shell-empty'>Starting shell…</p>}
        {output === '' && status === 'error' && (
          <p className='shell-empty'>
            The shell could not be started. Use ↻ to try again.
          </p>
        )}
        <pre>
          {terminalLines(output).map((spans, line) => (
            <div key={line}>{renderTerminalLine(spans)}</div>
          ))}
        </pre>
      </div>
    </WidgetLayout>
  )
}

/** Lines and spans are positional; a stable identity would still rewrite under progress output. */
function renderTerminalLine(spans: ReturnType<typeof terminalLines>[number]): ReactNode {
  if (spans.length === 0) return '\n'
  return spans.map((span, index) => (
    <span className={span.className || undefined} key={index}>{span.text}</span>
  ))
}

function statusLabel(status: ShellStatus, shell: string): string {
  if (status === 'connecting') return 'Connecting…'
  if (status === 'error') return 'Unavailable'
  if (status === 'exited') return 'Exited — press ↻'
  return shell || 'Ready'
}
