import { type ReactNode, useEffect, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import type { CommandDefinition, CommandId } from '../commands/command-registry.ts'
import { shortcutFromEvent, shortcutConflicts } from '../commands/command-registry.ts'
import { contrastColor, THEME_VARIABLES, type Theme, type ThemeVariable } from './themes.ts'
import { defaultBackendBaseUrl, HERMES_PLUGIN_BACKEND_PATH } from './backend-connection.ts'

const themeVariableLabels: Record<ThemeVariable, string> = {
  canvas: 'Background',
  surface: 'Surface',
  ink: 'Text',
  accent: 'Primary accent',
  secondary: 'Secondary accent',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
}

// ── Tab registry ───────────────────────────────────────────────────

/** Identifies a settings tab. Extend this union when adding a new tab. */
export type SettingsTabId = 'themes' | 'terminal' | 'shortcuts' | 'backend'

/** Describes one tab in the settings modal. */
export interface SettingsTabDefinition {
  id: SettingsTabId
  label: string
}

/** Ordered list of tabs rendered in the settings modal. */
export const settingsTabs: SettingsTabDefinition[] = [
  { id: 'themes', label: 'Color themes' },
  { id: 'backend', label: 'Backend connection' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'shortcuts', label: 'Shortcuts' },
]

// ── Shared props ───────────────────────────────────────────────────

interface SettingsPanelProps {
  backendBaseUrl: string
  definitions: CommandDefinition[]
  shortcuts: Partial<Record<CommandId, string>>
  terminalCommand: string
  themes: Theme[]
  activeThemeId: string
  onBackendBaseUrlChange: (value: string) => void
  onBackendBaseUrlReset: () => void
  onPreviewTheme: (theme: Theme | undefined) => void
  onChange: (id: CommandId, shortcut: string) => void
  onTerminalCommandChange: (value: string) => void
  onSelectTheme: (id: string) => void
  onDuplicateTheme: () => void
  onRenameTheme: (id: string, name: string) => void
  onUpdateThemeColor: (id: string, variable: ThemeVariable, color: string) => void
  onDeleteTheme: (id: string) => void
  onResetTheme: (id: string) => void
  onReset: () => void
  onClose: () => void
}

// ── Section components ─────────────────────────────────────────────

interface TabSectionProps {
  children: ReactNode
  id: string
  labelledBy: string
}

/** Wraps a tab panel with the correct ARIA attributes. */
function TabPanel({ children, id, labelledBy }: TabSectionProps) {
  return (
    <div aria-labelledby={labelledBy} className='settings-tab-panel' id={id} role='tabpanel'>
      {children}
    </div>
  )
}

interface ThemeSettingsProps {
  activeTheme: Theme | undefined
  editableTheme: boolean
  themeName: string
  themes: Theme[]
  onSelectTheme: (id: string) => void
  onDuplicateTheme: () => void
  onUpdateThemeColor: (id: string, variable: ThemeVariable, color: string) => void
  onDeleteTheme: (id: string) => void
  onResetTheme: (id: string) => void
  onPreviewTheme: (theme: Theme | undefined) => void
  onThemeNameChange: (name: string) => void
  onCommitThemeName: () => void
}

function ThemeSettings(
  {
    activeTheme,
    editableTheme,
    themeName,
    themes,
    onSelectTheme,
    onDuplicateTheme,
    onUpdateThemeColor,
    onDeleteTheme,
    onResetTheme,
    onThemeNameChange,
    onCommitThemeName,
    onPreviewTheme,
  }: ThemeSettingsProps,
) {
  // Theme hovered in the dropdown, applied live to the app until the pointer leaves.
  const [previewTheme, setPreviewTheme] = useState<Theme | undefined>(undefined)

  useEffect(() => {
    onPreviewTheme(previewTheme)
  }, [onPreviewTheme, previewTheme])

  return (
    <section className='theme-settings'>
      <p>
        Choose a theme and edit its 8 source colors directly. Built-in changes are saved locally and
        can be restored anytime. Surfaces, text shades, borders, hover states, and contrast colours
        are generated automatically.
      </p>
      <div className='theme-toolbar'>
        <Select.Root
          onOpenChange={(open) => {
            if (!open) setPreviewTheme(undefined)
          }}
          onValueChange={onSelectTheme}
          value={activeTheme?.id ?? ''}
        >
          <Select.Trigger aria-label='Active color theme' className='theme-select-trigger'>
            <Select.Value placeholder='Choose a theme' />
            <Select.Icon className='theme-select-chevron' />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className='theme-select-content' position='popper' sideOffset={4}>
              <Select.Viewport onPointerLeave={() => setPreviewTheme(undefined)}>
                {themes.map((theme) => (
                  <Select.Item
                    className='theme-select-item'
                    key={theme.id}
                    onPointerEnter={() => setPreviewTheme(theme)}
                    value={theme.id}
                    style={{
                      '--item-accent': theme.palette.accent,
                      '--item-surface': theme.palette.surface,
                      '--item-ink': theme.palette.ink,
                      '--item-on-accent': contrastColor(theme.palette.accent),
                    } as React.CSSProperties}
                  >
                    <Select.ItemText>
                      {theme.name}
                      {theme.builtIn
                        ? ' · Built-in'
                        : ''}
                    </Select.ItemText>
                    <Select.ItemIndicator aria-hidden='true'>✓</Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <button onClick={onDuplicateTheme} type='button'>New custom theme</button>
      </div>
      {activeTheme && (
        <>
          <div className='theme-name'>
            <label>
              Name<input
                disabled={!editableTheme}
                onBlur={onCommitThemeName}
                onChange={(event) => onThemeNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onCommitThemeName()
                  }
                }}
                value={themeName}
              />
            </label>
            {activeTheme.builtIn
              ? (
                <button onClick={() => onResetTheme(activeTheme.id)} type='button'>
                  Restore default
                </button>
              )
              : (
                <button
                  disabled={!editableTheme}
                  onClick={() => onDeleteTheme(activeTheme.id)}
                  type='button'
                >
                  Delete
                </button>
              )}
          </div>
          <div className='theme-colors'>
            {THEME_VARIABLES.map((variable) => (
              <label className='theme-color' key={variable}>
                <span>{themeVariableLabels[variable]}</span>
                <input
                  aria-label={themeVariableLabels[variable]}
                  disabled={!editableTheme}
                  onChange={(event) =>
                    onUpdateThemeColor(
                      activeTheme.id,
                      variable,
                      event.target.value,
                    )}
                  type='color'
                  value={activeTheme.palette[variable]}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

interface BackendSettingsProps {
  backendBaseUrl: string
  onChange: (value: string) => void
  onReset: () => void
}

function BackendSettings({ backendBaseUrl, onChange, onReset }: BackendSettingsProps) {
  const [draft, setDraft] = useState(backendBaseUrl)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(backendBaseUrl)
    setError('')
  }, [backendBaseUrl])

  return (
    <section>
      <p>
        Pi Coding UI runs inside the Hermes dashboard. By default this tab talks to the Pi backend
        on the same server through the Hermes plugin proxy at{' '}
        <code>{HERMES_PLUGIN_BACKEND_PATH}</code>. Start that backend on the server with{' '}
        <code>hermes pi-coding-ui start</code>.
      </p>
      <label className='terminal-command-row'>
        <span>Backend base URL</span>
        <input
          aria-label='Backend base URL'
          onChange={(event) => setDraft(event.target.value)}
          placeholder={defaultBackendBaseUrl()}
          spellCheck={false}
          value={draft}
        />
        {error && <small className='terminal-command-error'>{error}</small>}
        <small>
          Use the Hermes plugin mount or a direct loopback URL such as{' '}
          <code>http://127.0.0.1:43121</code>{' '}
          for local debugging. The default uses the dashboard origin plus{' '}
          <code>{HERMES_PLUGIN_BACKEND_PATH}</code>.
        </small>
      </label>
      <div className='theme-toolbar'>
        <button
          onClick={() => {
            try {
              onChange(draft)
              setError('')
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
          type='button'
        >
          Save backend URL
        </button>
        <button onClick={onReset} type='button'>
          Use default
        </button>
      </div>
    </section>
  )
}

interface TerminalSettingsProps {
  terminalCommand: string
  onTerminalCommandChange: (value: string) => void
}

function TerminalSettings({ terminalCommand, onTerminalCommandChange }: TerminalSettingsProps) {
  return (
    <section>
      <label className='terminal-command-row'>
        <span>External terminal command</span>
        <input
          aria-label='Terminal command template'
          onChange={(event) => onTerminalCommandChange(event.target.value)}
          placeholder='Platform default'
          spellCheck={false}
          value={terminalCommand}
        />
        {terminalCommand && !terminalCommand.includes('{cwd}') && (
          <small className='terminal-command-error'>
            The template must contain {'{cwd}'} where the workspace folder should be inserted.
          </small>
        )}
        <small>
          Leave empty for the platform default, or use {'{cwd}'} for the workspace folder.
        </small>
      </label>
    </section>
  )
}

interface ShortcutsSettingsProps {
  definitions: CommandDefinition[]
  shortcuts: Partial<Record<CommandId, string>>
  conflicts: Set<CommandId>
  capturing: CommandId | null
  onCaptureStart: (id: CommandId) => void
  onCaptureEnd: () => void
  onChange: (id: CommandId, shortcut: string) => void
}

function ShortcutsSettings(
  { definitions, shortcuts, conflicts, capturing, onCaptureStart, onCaptureEnd, onChange }:
    ShortcutsSettingsProps,
) {
  return (
    <section>
      <p>Focus a field, then press the exact key or key combination you want.</p>
      {definitions
        .filter(({ id }) => id !== 'send')
        .map((definition) => (
          <div
            className={conflicts.has(definition.id)
              ? 'shortcut-row conflict'
              : 'shortcut-row'}
            key={definition.id}
          >
            <span>{definition.label}{conflicts.has(definition.id) && <small>Conflict</small>}</span>
            <span className='shortcut-control'>
              <input
                aria-label={`Shortcut: ${definition.label}`}
                onBlur={onCaptureEnd}
                onKeyDown={(event) => {
                  event.preventDefault()
                  const value = shortcutFromEvent(event)
                  if (value) {
                    onChange(definition.id, value)
                    onCaptureEnd()
                  }
                }}
                onFocus={() => onCaptureStart(definition.id)}
                placeholder='Unassigned'
                readOnly
                value={capturing === definition.id ? 'Press keys…' : shortcuts[definition.id] ?? ''}
              />
              <button
                aria-label={`Clear shortcut: ${definition.label}`}
                disabled={!shortcuts[definition.id]}
                onClick={() => onChange(definition.id, '')}
                type='button'
              >
                Clear
              </button>
            </span>
          </div>
        ))}
    </section>
  )
}

// ── Main panel ─────────────────────────────────────────────────────

/** Configures local shortcuts, terminal behavior, and editable color themes. */
export function SettingsPanel({
  backendBaseUrl,
  definitions,
  shortcuts,
  terminalCommand,
  themes,
  activeThemeId,
  onBackendBaseUrlChange,
  onBackendBaseUrlReset,
  onPreviewTheme,
  onChange,
  onTerminalCommandChange,
  onSelectTheme,
  onDuplicateTheme,
  onRenameTheme,
  onUpdateThemeColor,
  onDeleteTheme,
  onResetTheme,
  onReset,
  onClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('themes')
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [themeName, setThemeName] = useState('')
  const conflicts = shortcutConflicts(shortcuts)
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) ?? themes[0]
  const editableTheme = Boolean(activeTheme)

  useEffect(() => {
    setThemeName(activeTheme?.name ?? '')
  }, [activeTheme?.id, activeTheme?.name])

  const commitThemeName = () => {
    if (activeTheme && themeName.trim() !== activeTheme.name)
      onRenameTheme(activeTheme.id, themeName)
  }

  return (
    <div
      className='settings-backdrop'
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section aria-label='Settings' className='settings-panel' role='dialog'>
        <header>
          <div>
            <span>Preferences</span>
            <h2>Settings</h2>
          </div>
          <button aria-label='Close settings' onClick={onClose} type='button'>×</button>
        </header>
        <div className='settings-tab-bar' role='tablist'>
          {settingsTabs.map((tab) => (
            <button
              aria-controls={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              id={`settings-tab-btn-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role='tab'
              type='button'
            >
              {tab.label}
            </button>
          ))}
        </div>
        <section className='settings-content'>
          {activeTab === 'themes' && (
            <TabPanel key='themes' id='settings-tab-themes' labelledBy='settings-tab-btn-themes'>
              <ThemeSettings
                activeTheme={activeTheme}
                editableTheme={editableTheme}
                onCommitThemeName={commitThemeName}
                onDeleteTheme={onDeleteTheme}
                onDuplicateTheme={onDuplicateTheme}
                onPreviewTheme={onPreviewTheme}
                onSelectTheme={onSelectTheme}
                onThemeNameChange={setThemeName}
                onResetTheme={onResetTheme}
                onUpdateThemeColor={onUpdateThemeColor}
                themeName={themeName}
                themes={themes}
              />
            </TabPanel>
          )}
          {activeTab === 'backend' && (
            <TabPanel key='backend' id='settings-tab-backend' labelledBy='settings-tab-btn-backend'>
              <BackendSettings
                backendBaseUrl={backendBaseUrl}
                onChange={onBackendBaseUrlChange}
                onReset={onBackendBaseUrlReset}
              />
            </TabPanel>
          )}
          {activeTab === 'terminal' && (
            <TabPanel
              key='terminal'
              id='settings-tab-terminal'
              labelledBy='settings-tab-btn-terminal'
            >
              <TerminalSettings
                onTerminalCommandChange={onTerminalCommandChange}
                terminalCommand={terminalCommand}
              />
            </TabPanel>
          )}
          {activeTab === 'shortcuts' && (
            <TabPanel
              key='shortcuts'
              id='settings-tab-shortcuts'
              labelledBy='settings-tab-btn-shortcuts'
            >
              <ShortcutsSettings
                capturing={capturing}
                conflicts={conflicts}
                definitions={definitions}
                onChange={onChange}
                onCaptureEnd={() => setCapturing(null)}
                onCaptureStart={setCapturing}
                shortcuts={shortcuts}
              />
            </TabPanel>
          )}
        </section>
        <footer>
          <button onClick={onReset} type='button'>Reset shortcuts</button>
          <button className='primary' onClick={onClose} type='button'>Done</button>
        </footer>
      </section>
    </div>
  )
}
