export interface DirectoryCompletionTarget {
  parentPath: string
  pathPrefix: string
  namePrefix: string
}

/** Isolates the directory to scan and name fragment for POSIX, drive, UNC, and home paths. */
export function directoryCompletionTarget(input: string): DirectoryCompletionTarget | null {
  const path = input.trim()
  if (!path || path === '~') return { parentPath: '~', pathPrefix: '~/', namePrefix: '' }
  if (path.startsWith('~/') || path.startsWith('/')) return splitPath(path, '/')
  if (path.startsWith('~\\')) return splitPath(path, '\\')
  if (/^[A-Za-z]:[\\/]/.test(path)) return splitPath(path, lastSeparator(path))
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(path)) return splitPath(path, lastSeparator(path))
  return null
}

function splitPath(path: string, separator: string): DirectoryCompletionTarget {
  const index = path.lastIndexOf(separator)
  const pathPrefix = path.slice(0, index + 1)
  const namePrefix = path.slice(index + 1)
  const parentPath = namePrefix ? pathPrefix.slice(0, -1) : path.slice(0, -1)
  return {
    parentPath: /^[A-Za-z]:[\\/]$/.test(path) ? path : parentPath || separator,
    pathPrefix,
    namePrefix,
  }
}

function lastSeparator(path: string): string {
  return Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) === path.lastIndexOf('\\')
    ? '\\'
    : '/'
}
