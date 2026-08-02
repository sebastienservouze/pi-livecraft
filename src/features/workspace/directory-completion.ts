export interface DirectoryCompletionTarget {
  parentPath: string
  pathPrefix: string
  namePrefix: string
}

/** Isolates the directory to scan for POSIX, home, drive-letter, and UNC paths. */
export function directoryCompletionTarget(input: string): DirectoryCompletionTarget | null {
  const path = input.trim()
  if (!path) return { parentPath: '~', pathPrefix: '~/', namePrefix: '' }
  if (path === '~') return { parentPath: '~', pathPrefix: '~/', namePrefix: '' }

  const windowsPath = /^[A-Za-z]:[\\/]/.test(path)
    || /^\\\\[^\\/]+[\\/]/.test(path)
    || path.startsWith('~\\')
  if (!windowsPath && !path.startsWith('/') && !path.startsWith('~/')) return null

  const slash = path.lastIndexOf('/')
  const backslash = windowsPath ? path.lastIndexOf('\\') : -1
  const separatorIndex = Math.max(slash, backslash)
  const separator = backslash > slash ? '\\' : '/'
  const pathPrefix = path.slice(0, separatorIndex + 1)
  const namePrefix = path.slice(separatorIndex + 1)
  const parent = namePrefix ? pathPrefix.slice(0, -1) : path.slice(0, -1)
  const parentPath = /^[A-Za-z]:$/.test(parent) ? `${parent}${separator}` : parent || '/'

  return { parentPath, pathPrefix, namePrefix }
}
