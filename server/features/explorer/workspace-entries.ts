import { readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { WorkspaceEntries, WorkspaceEntry } from '../../../shared/types.ts'

export class WorkspaceEntriesError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Lists one directory of the workspace for the in-app file browser.
 *
 * Browsing never leaves the workspace root: the resolved real path must stay
 * inside it, so symlinks cannot widen what the browser can read.
 */
export async function listWorkspaceEntries(
  workspacePath: string,
  requestedPath = '',
): Promise<WorkspaceEntries> {
  const root = await realpath(workspacePath)
  const target = await resolveInsideRoot(root, requestedPath)
  if (!(await stat(target)).isDirectory())
    throw new WorkspaceEntriesError('Path must be a directory', 400)

  const directoryEntries = await readdir(target, { withFileTypes: true })
  const entries: WorkspaceEntry[] = []
  for (const entry of directoryEntries) {
    if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink()) continue
    const absolutePath = resolve(target, entry.name)
    const details = await describeEntry(absolutePath)
    if (!details) continue
    entries.push({
      name: entry.name,
      relativePath: toRelative(root, absolutePath),
      ...details,
    })
  }

  entries.sort((left, right) =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name)
      : left.kind === 'directory'
      ? -1
      : 1
  )

  const relativePath = toRelative(root, target)
  return {
    path: target,
    relativePath,
    parentRelativePath: relativePath === '' ? null : toRelative(root, resolve(target, '..')),
    entries,
  }
}

/** Reads the entry kind and metadata, skipping anything unreadable or dangling. */
async function describeEntry(
  absolutePath: string,
): Promise<Pick<WorkspaceEntry, 'kind' | 'size' | 'modifiedMs'> | null> {
  try {
    const details = await stat(absolutePath)
    if (!details.isDirectory() && !details.isFile()) return null
    return {
      kind: details.isDirectory() ? 'directory' : 'file',
      size: details.isDirectory() ? null : details.size,
      modifiedMs: details.mtimeMs,
    }
  } catch {
    return null
  }
}

async function resolveInsideRoot(root: string, requestedPath: string): Promise<string> {
  const requested = requestedPath.trim()
  if (isAbsolute(requested)) throw new WorkspaceEntriesError('Path must be relative', 400)
  let target: string
  try {
    target = await realpath(resolve(root, requested))
  } catch {
    throw new WorkspaceEntriesError('Directory does not exist', 404)
  }
  const fromRoot = relative(root, target)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
    throw new WorkspaceEntriesError('Path must be inside the working directory', 403)
  return target
}

function toRelative(root: string, absolutePath: string): string {
  const value = relative(root, absolutePath)
  return value === '' ? '' : value.split('\\').join('/')
}
