import { useEffect, useState } from 'react'
import type { ManagerRuntimeStatus } from '../../../shared/types.ts'
import './manager.css'

interface ManagerRuntimeNoticeProps {
  activeSession: boolean
  status: ManagerRuntimeStatus
  onRestart: () => Promise<void>
  onError: (cause: unknown) => void
}

/** Compact control at the top-left of the chat that expands on hover/focus to show manager status and restart action. */
export function ManagerRuntimeNotice(
  { activeSession, status, onRestart, onError }: ManagerRuntimeNoticeProps,
) {
  const [requesting, setRequesting] = useState(false)
  useEffect(() => {
    if (status.state !== 'stale') setRequesting(false)
  }, [status.state])

  const restartFailed = status.state === 'disconnected' && Boolean(status.error)
  if (
    status.state === 'current' || status.state === 'checking'
    || (status.state === 'disconnected' && !restartFailed)
  ) return null

  const restarting = status.state === 'restarting' || requesting
  const unknown = status.state === 'unknown' || restartFailed
  const disabled = restarting || activeSession || !status.canRestart
  const hasAction = !unknown && (status.canRestart || restarting)

  /** Keeps the action disabled through the HTTP acknowledgement and reports request errors. */
  async function restart(): Promise<void> {
    setRequesting(true)
    try {
      await onRestart()
    } catch (cause) {
      setRequesting(false)
      onError(cause)
    }
  }

  const title = restartFailed
    ? 'Manager restart failed'
    : unknown
    ? 'Manager version unavailable'
    : restarting
    ? 'Restarting the manager…'
    : 'Manager needs update'

  const description = unknown
    ? status.error ?? 'The running manager version could not be verified.'
    : activeSession
    ? 'Wait for active Pi sessions to finish before restarting.'
    : status.canRestart
    ? 'The running code no longer matches its runtime files. Idle sessions will close and can be reopened from history.'
    : 'Restart the plugin services to load the updated manager code.'

  const label = `${title}. ${description}`

  return (
    <aside
      aria-label={label}
      aria-live='polite'
      className={`manager-runtime-control${unknown ? ' unknown' : ''}${
        restarting ? ' restarting' : ''
      }${hasAction ? ' actionable' : ''}`}
      tabIndex={hasAction ? undefined : 0}
    >
      <span aria-hidden='true' className='manager-runtime-control-icon'>{unknown ? '⚠' : '↻'}</span>
      <span className='manager-runtime-control-copy'>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {hasAction && (
        <button
          aria-busy={restarting}
          aria-label='Restart the manager'
          disabled={disabled}
          onClick={() => void restart()}
          type='button'
        >
          {restarting ? 'Restarting…' : 'Restart'}
        </button>
      )}
    </aside>
  )
}
