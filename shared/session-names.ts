/** Sentinel a freshly created Pi session carries until its first prompt or a Pi-generated title names it. */
export const unnamedSessionName = 'Nouvelle session'

/** Default worker label shown before a session reports the agent driving it. */
export const defaultWorkerName = 'Pi'

const genericNames = new Set([
  unnamedSessionName.toLowerCase(),
  'new session',
  'new thread',
  'nouvelle discussion',
  'untitled',
])

/** Reports whether a raw session name is a placeholder that must never reach the user as a title. */
export function isGenericSessionName(name: string | undefined): boolean {
  const normalized = (name ?? '').trim().toLowerCase()
  return normalized.length === 0 || genericNames.has(normalized)
}
