import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { rightWidgetDefinitions, type RightWidget } from '../right-sidebar/right-sidebar.ts'

type CoreCommandId =
  | 'new-session'
  | 'send'
  | 'abort'
  | 'open-thinking'
  | 'open-model'
  | 'open-agent'
  | 'copy-last-response'
  | 'open-palette'
  | 'open-settings'
  | 'open-directory-picker'
  | 'workspace-previous'
  | 'focus-composer'
  | 'next-session'
  | 'previous-session'
  | 'toggle-conversation-view'
export type WidgetCommandId = `open-widget-${RightWidget}`
export type CommandId = CoreCommandId | WidgetCommandId

export interface CommandDefinition {
  id: CommandId
  label: string
  description?: string
}

export const commandDefinitions: CommandDefinition[] = [
  { id: 'new-session', label: 'New session' },
  { id: 'send', label: 'Send message' },
  { id: 'abort', label: 'Abort Pi' },
  { id: 'open-thinking', label: 'Open thinking level' },
  { id: 'open-model', label: 'Open model picker' },
  { id: 'open-agent', label: 'Open agent picker' },
  { id: 'copy-last-response', label: 'Copy last response' },
  { id: 'open-palette', label: 'Open command palette' },
  { id: 'open-settings', label: 'Open settings' },
  { id: 'open-directory-picker', label: 'Open directory picker' },
  { id: 'workspace-previous', label: 'Switch to previous workspace' },
  { id: 'focus-composer', label: 'Focus composer' },
  { id: 'next-session', label: 'Next session' },
  { id: 'previous-session', label: 'Previous session' },
  { id: 'toggle-conversation-view', label: 'Toggle conversation view' },
  ...rightWidgetDefinitions.map(({ id, label }) => ({
    id: rightWidgetCommandId(id),
    label: `Open ${label}`,
  })),
]

export const defaultShortcuts: Partial<Record<CommandId, string>> = {
  'new-session': 'alt+n',
  abort: 'escape',
  'open-thinking': 'alt+2',
  'open-model': 'alt+1',
  'open-agent': 'alt+3',
  'copy-last-response': 'alt+c',
  'open-palette': 'alt+k',
  'open-settings': 'alt+s',
  'open-directory-picker': 'alt+d',
  'workspace-previous': 'alt+&',
  'focus-composer': 'alt+2',
  'next-session': 'alt+arrowright',
  'previous-session': 'alt+arrowleft',
  'open-widget-analysis': 'alt+a',
  'open-widget-git': 'alt+g',
  'open-widget-quotas': 'alt+q',
  'open-widget-todo': 'alt+y',
  'open-widget-explorer': 'alt+o',
  'open-widget-shell': 'alt+t',
}

/** Gives every sidebar widget a stable command without duplicating its identity. */
export function rightWidgetCommandId(widget: RightWidget): WidgetCommandId {
  return `open-widget-${widget}`
}

/** Resolves widget commands while leaving unrelated productivity commands untouched. */
export function rightWidgetFromCommand(commandId: CommandId): RightWidget | null {
  return rightWidgetDefinitions.find(({ id }) => rightWidgetCommandId(id) === commandId)?.id ?? null
}

/** Preserves the exact modifiers pressed while producing a stable shortcut value. */
export function shortcutFromEvent(
  event: {
    key: string
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  },
): string {
  const key = event.key.toLowerCase() === ' ' ? 'space' : event.key.toLowerCase()
  if (['alt', 'control', 'meta', 'shift'].includes(key)) return ''
  const modifiers = [
    event.ctrlKey ? 'ctrl' : '',
    event.metaKey ? 'meta' : '',
    event.altKey ? 'alt' : '',
    event.shiftKey ? 'shift' : '',
  ]
    .filter(Boolean)
  return [...modifiers, key].join('+')
}

/** Replaces the former cross-platform modifier with the current platform's exact key. */
export function migrateLegacyShortcut(shortcut: string, primaryModifier: 'ctrl' | 'meta'): string {
  return shortcut.replace(/^mod(?=\+|$)/, primaryModifier)
}

/** Returns conflicting shortcuts while ignoring commands without a shortcut. */
export function shortcutConflicts(shortcuts: Partial<Record<CommandId, string>>): Set<CommandId> {
  const seen = new Map<string, CommandId>()
  const conflicts = new Set<CommandId>()
  for (const [id, shortcut] of Object.entries(shortcuts) as [CommandId, string | undefined][]) {
    if (!shortcut) continue
    const previous = seen.get(shortcut)
    if (previous) {
      conflicts.add(previous)
      conflicts.add(id)
    } else seen.set(shortcut, id)
  }
  return conflicts
}

/** Extracts copyable text from an assistant response without changing its Markdown. */
export function lastAssistantText(messages: JsonObject[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const content = message.content ?? message.output
    if (typeof content === 'string' && content.trim()) return content
    if (Array.isArray(content)) {
      const text = content
        .filter(isObject)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => String(part.text))
        .join('')
      if (text.trim()) return text
    }
  }
  return ''
}
