import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { listDirectories } from '../../api.ts'
import { directoryCompletionTarget } from './directory-completion.ts'
import { projectLabel } from './sidebar-projects.ts'

/**
 * Explicit project/workspace picker: completes and validates a local path, and lists registered
 * recent projects and local worktrees for selection. Project identity is always the canonical path
 * returned by `listDirectories`, never the display label.
 *
 * Directory suggestions use a version counter: each keystroke increments
 * `completionVersionRef`, and only the latest request's result is applied.
 * This prevents a slow `listDirectories()` response from overwriting
 * newer suggestions for the path currently being typed.
 */
export function DirectoryPicker({ initialPath, recentPaths, onClose, onError, onSelect }: {
  initialPath: string
  recentPaths: string[]
  onClose: () => void
  onError: (cause: unknown) => void
  onSelect: (path: string) => void
}) {
  const [path, setPath] = useState(initialPath)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const completionVersionRef = useRef(0)

  // Stale requests must not replace suggestions for the path currently being entered.
  useEffect(() => {
    const version = ++completionVersionRef.current
    const target = directoryCompletionTarget(path)
    if (!target) {
      setSuggestions([])
      return
    }

    void listDirectories(target.parentPath)
      .then((parent) => {
        if (version !== completionVersionRef.current) return
        setSuggestions(
          parent
            .directories
            .filter((directory) => directory.name.startsWith(target.namePrefix))
            .map((directory) => `${target.pathPrefix}${directory.name}`)
            .filter((suggestion) => suggestion !== initialPath),
        )
        setActiveSuggestion(-1)
      })
      .catch(() => {
        if (version === completionVersionRef.current) setSuggestions([])
      })
  }, [path])

  const query = path.trim().toLowerCase()
  const visibleRecentPaths = useMemo(
    () =>
      recentPaths
        .filter((recentPath) => recentPath !== initialPath)
        .filter((recentPath) =>
          query.length === 0
          || recentPath.toLowerCase().includes(query)
          || projectLabel(recentPath).toLowerCase().includes(query)
        ),
    [initialPath, query, recentPaths],
  )

  /** Verifies that the path is still accessible before adopting it as the workspace. */
  function selectDirectory(nextPath: string): void {
    void listDirectories(nextPath).then((directory) => onSelect(directory.path)).catch(onError)
  }

  /** Applies standard completion-list shortcuts without intercepting normal input. */
  function handlePathKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      event.preventDefault()
      setActiveSuggestion((current) =>
        event.key === 'ArrowDown'
          ? Math.min(current + 1, suggestions.length - 1)
          : Math.max(current - 1, 0)
      )
      return
    }
    if (event.key === 'Tab') {
      const suggestion = suggestions[activeSuggestion >= 0 ? activeSuggestion : 0]
      if (!suggestion) return
      event.preventDefault()
      setPath(suggestion)
      setActiveSuggestion(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectDirectory(path)
    }
  }

  return (
    <div className='modal-backdrop' role='presentation'>
      <section
        aria-labelledby='directory-picker-title'
        aria-modal='true'
        className='modal directory-picker'
        role='dialog'
      >
        <h2 id='directory-picker-title'>Switch project</h2>
        <div className='project-picker-current'>
          <span>Current project</span>
          <strong>{projectLabel(initialPath)}</strong>
          <small>{initialPath}</small>
        </div>
        <label className='directory-path-label' htmlFor='directory-path'>
          Project path or search
        </label>
        <input
          aria-activedescendant={activeSuggestion >= 0
            ? `directory-suggestion-${activeSuggestion}`
            : undefined}
          autoComplete='off'
          autoFocus
          aria-autocomplete='list'
          aria-controls={suggestions.length > 0 ? 'directory-suggestions' : undefined}
          aria-expanded={suggestions.length > 0}
          className='directory-path-input'
          id='directory-path'
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={handlePathKeyDown}
          placeholder='~/projects or /absolute/path'
          role='combobox'
          value={path}
        />
        <p className='directory-path-hint'>
          Tab completes · ↑↓ navigate · Enter selects · Escape cancels
        </p>
        {suggestions.length > 0 && (
          <div
            aria-label='Directory suggestions'
            className='directory-suggestions'
            id='directory-suggestions'
            role='listbox'
          >
            {suggestions.map((suggestion, index) => (
              <div
                aria-selected={index === activeSuggestion}
                className={index === activeSuggestion ? 'active' : undefined}
                id={`directory-suggestion-${index}`}
                key={suggestion}
                onClick={() => {
                  setPath(suggestion)
                  setActiveSuggestion(-1)
                }}
                onMouseDown={(event) => event.preventDefault()}
                role='option'
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
        {visibleRecentPaths.length > 0 && (
          <section aria-label='Projects' className='recent-workspaces'>
            <strong>Projects</strong>
            <div>
              {visibleRecentPaths
                .map((recentPath) => (
                  <button
                    className='project-picker-option'
                    key={recentPath}
                    onClick={() => selectDirectory(recentPath)}
                    type='button'
                  >
                    <span className='project-picker-option-label'>{projectLabel(recentPath)}</span>
                    <span className='project-picker-option-path'>{recentPath}</span>
                  </button>
                ))}
            </div>
          </section>
        )}
        <div className='modal-actions'>
          <button onClick={onClose} type='button'>Cancel</button>
          <button className='primary' onClick={() => selectDirectory(path)} type='button'>
            Open
          </button>
        </div>
      </section>
    </div>
  )
}
