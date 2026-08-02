/** Presentation produced by a tool-call presenter, rendered in the conversation header. */
export interface ToolCallPresentation {
  headerDetail?: { text: string; title: string; suffix?: string }
  pendingDetail?: string
}

export type ToolCallPresenter = (
  args: unknown,
  repositoryRoot?: string | null,
) => ToolCallPresentation

export function truncateToolText(
  text: string,
  maxLength = 140,
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false }
  return { text: `${text.slice(0, maxLength)}…`, truncated: true }
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function readLineRange(args: Record<string, unknown>): string | undefined {
  const offset = positiveInteger(args.offset)
  const limit = positiveInteger(args.limit)
  if (offset === undefined && limit === undefined) return undefined

  const start = offset ?? 1
  const end = limit === undefined ? '' : String(start + limit - 1)
  return `[${start}:${end}]`
}

export function pathFromRepositoryRoot(path: string, repositoryRoot?: string | null): string {
  if (!repositoryRoot) return path

  if (
    /^[A-Za-z]:[\\/]/.test(repositoryRoot) || repositoryRoot.startsWith('\\\\')
    || repositoryRoot.startsWith('//')
  ) {
    const root = repositoryRoot.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalizedPath = path.replace(/\\/g, '/')
    if (normalizedPath.replace(/\/+$/, '').toLowerCase() === root.toLowerCase()) return '.'
    return normalizedPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? normalizedPath.slice(root.length + 1)
      : path
  }

  const root = repositoryRoot.replace(/\/+$/, '')
  if (path === root) return '.'
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}
