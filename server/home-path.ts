import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Expands the home shorthand accepted by workspace routes before filesystem canonicalization. */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(homedir(), path.slice(2))
  return path
}
