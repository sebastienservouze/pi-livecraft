import type { ShellSessionInfo } from '../../../shared/types.ts'

/**
 * Remembers the open shell so collapsing the panel does not end the session.
 * Only one session is kept: the panel always works on the selected workspace.
 */
let current: ShellSessionInfo | null = null

export function cachedShellSession(cwd: string): ShellSessionInfo | null {
  return current?.cwd === cwd ? current : null
}

export function rememberShellSession(session: ShellSessionInfo): ShellSessionInfo {
  current = session
  return session
}

/** Drops the cached session and returns it so the caller can close it on the backend. */
export function forgetShellSession(): ShellSessionInfo | null {
  const session = current
  current = null
  return session
}
