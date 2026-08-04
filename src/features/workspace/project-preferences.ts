export const archivedProjectsStorageKey = 'pi-livecraft.archived-projects'
export const projectOrderStorageKey = 'pi-livecraft.project-order'
export const pinnedSessionsStorageKey = 'pi-livecraft.pinned-sessions'
export const archivedSessionsStorageKey = 'pi-livecraft.archived-sessions'
export const collapsedProjectsStorageKey = 'pi-livecraft.collapsed-projects'

/** Adds or removes a project path from a preference list, returning a new stable-ordered list. */
export function toggleProjectPath(paths: readonly string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path]
}
