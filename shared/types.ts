export type JsonObject = Record<string, unknown>

export interface SessionSummary {
  id: string
  cwd: string
  name: string
  sessionPath?: string
  activeAgent?: string
  status: 'starting' | 'idle' | 'running' | 'exited'
  pendingUi: JsonObject[]
}

export interface RecentSession {
  id: string
  cwd: string
  name: string
  sessionPath: string
  updatedAt: number
}

export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  path: string
  parentPath: string | null
  directories: DirectoryEntry[]
}

export interface GitFileChange {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number | null
  deletions: number | null
}

export interface GitCommit {
  hash: string
  subject: string
  files: GitFileChange[]
}

export interface GitSnapshot {
  repository: boolean
  root: string | null
  branch: string | null
  files: GitFileChange[]
  ahead: number
  commits: GitCommit[]
}

export interface GitActionResult {
  committed: boolean
  pushed: boolean
  pushError?: string
}

export interface GitPushResult {
  pushed: boolean
  pushError?: string
}

export interface GitResetResult {
  hash: string
}

export interface GitRevertResult {
  hash: string
}

export interface GitFileDiff {
  path: string
  diff: string
}

export interface WorkspaceFile {
  path: string
  content: string
}

export interface TodoSessionLink {
  id: string
  name: string
  sessionPath: string
}

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  session?: TodoSessionLink
}

export interface ManagerRuntimeIdentity {
  instanceId: string
  startedAt: string
  runtimeRevision: string | null
  supervised: boolean
}

export type ManagerRuntimeState =
  | 'checking'
  | 'current'
  | 'stale'
  | 'restarting'
  | 'disconnected'
  | 'unknown'

export interface ManagerRuntimeStatus {
  state: ManagerRuntimeState
  canRestart: boolean
  error?: string
}

export interface ManagerRequest {
  id: string
  action:
    | 'list'
    | 'create'
    | 'open'
    | 'command'
    | 'improve_prompt'
    | 'run_prompt'
    | 'status'
    | 'restart'
  sessionId?: string
  cwd?: string
  name?: string
  sessionPath?: string
  command?: JsonObject
  prompt?: string
  systemPrompt?: string
  thinkingLevel?: string
  model?: { provider: string; modelId: string }
  extensions?: string[]
  tools?: string[]
  includeContextFiles?: boolean
  direction?: string
}

export interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface ManagerEvent {
  kind: 'event'
  event:
    | 'session_created'
    | 'session_exited'
    | 'manager_connected'
    | 'manager_disconnected'
    | 'manager_status'
    | 'pi'
  sessionId: string
  data?: unknown
  sequence?: number
}

export type ManagerMessage = ManagerResponse | ManagerEvent

export interface SessionStats {
  cost?: number
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number | null
    percent?: number | null
  }
}

export interface PromptTemplate {
  name: string
  content: string
  description?: string
}

export interface SessionSnapshot {
  state: JsonObject | null
  messages: JsonObject[]
  models: JsonObject[]
  commands: JsonObject[]
  promptTemplates: PromptTemplate[]
  stats: SessionStats | null
  liveEvents: Array<{ data: JsonObject; sequence: number }>
}

export interface OpenAiQuotaWindow {
  period: '5h' | '7d'
  remainingPercent: number
  resetsAt?: number
}

export interface CopilotQuotaWindow {
  name: string
  used: number
  limit: number
  resetsAt?: number
}

export interface QuotaProviderSnapshot<T> {
  data: T[]
  updatedAt?: number
  stale: boolean
  error?: string
}

export interface QuotaSnapshot {
  openai: QuotaProviderSnapshot<OpenAiQuotaWindow>
  copilot: QuotaProviderSnapshot<CopilotQuotaWindow>
  refreshing: boolean
  sessionRequired: boolean
}

export interface CapabilityEntry {
  name: string
  kind: 'skill' | 'extension'
  scope: 'user' | 'project'
  origin: string
  path: string
  description?: string
  enabled: boolean
  commands?: string[]
  toolCount?: number
}

export interface CapabilityInventory {
  skills: CapabilityEntry[]
  extensions: CapabilityEntry[]
  skillsError?: string
  extensionsError?: string
}

export type QuotaProviderReport<T> =
  | { ok: true; data: T[] }
  | { ok: false; error: string }

export interface QuotaReport {
  protocol: 'pi-livecraft.quotas'
  version: 1
  refreshedAt: number
  openai: QuotaProviderReport<OpenAiQuotaWindow>
  copilot: QuotaProviderReport<CopilotQuotaWindow>
}
