export const defaultWorkspaceSidebarWidth = 272
export const minWorkspaceSidebarWidth = 220
export const maxWorkspaceSidebarWidth = 480

export function clampWorkspaceSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultWorkspaceSidebarWidth
  return Math.min(maxWorkspaceSidebarWidth, Math.max(minWorkspaceSidebarWidth, Math.round(width)))
}

export function readWorkspaceSidebarWidth(value: string | null): number {
  return value === null ? defaultWorkspaceSidebarWidth : clampWorkspaceSidebarWidth(Number(value))
}

export const workspaceSidebarCollapsedKey = 'pi-livecraft.sidebar-collapsed'

export function readWorkspaceSidebarCollapsed(value: string | null): boolean {
  return value === 'true'
}
