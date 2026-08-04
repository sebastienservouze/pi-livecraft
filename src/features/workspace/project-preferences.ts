export const pinnedProjectsStorageKey = 'pi-livecraft.pinned-projects'
export const archivedProjectsStorageKey = 'pi-livecraft.archived-projects'

/** Adds or removes a project path from a preference list, returning a new stable-ordered list. */
export function toggleProjectPath(paths: readonly string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path]
}
