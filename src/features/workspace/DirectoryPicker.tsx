import { useState } from 'react'
import { pickDirectory } from '../../api.ts'
import { projectLabel } from './sidebar-projects.ts'

/** Chooses a local project folder or reopens one of the recent project roots. */
export function DirectoryPicker({ initialPath, recentPaths, onClose, onError, onSelect }: {
  initialPath: string
  recentPaths: string[]
  onClose: () => void
  onError: (cause: unknown) => void
  onSelect: (path: string) => void
}) {
  const [openingFolder, setOpeningFolder] = useState(false)
  const visibleRecentPaths = recentPaths.filter((recentPath) => recentPath !== initialPath)

  async function openFolder(): Promise<void> {
    setOpeningFolder(true)
    try {
      const result = await pickDirectory(initialPath)
      if (result.path) onSelect(result.path)
    } catch (cause) {
      onError(cause)
    } finally {
      setOpeningFolder(false)
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
        <h2 id='directory-picker-title'>Open project</h2>
        <div className='project-picker-current'>
          <span>Current project</span>
          <strong>{projectLabel(initialPath)}</strong>
          <small>{initialPath}</small>
        </div>
        <p className='directory-picker-intro'>
          Choose a folder from your computer, or reopen a recent project.
        </p>
        <button
          aria-busy={openingFolder}
          className='directory-picker-open primary'
          disabled={openingFolder}
          onClick={() => void openFolder()}
          type='button'
        >
          <FolderIcon />
          {openingFolder ? 'Opening…' : 'Open folder…'}
        </button>
        {visibleRecentPaths.length > 0
          ? (
            <section aria-label='Recent projects' className='recent-workspaces'>
              <strong>Recent projects</strong>
              <div>
                {visibleRecentPaths.map((recentPath) => (
                  <button
                    className='project-picker-option'
                    key={recentPath}
                    onClick={() => onSelect(recentPath)}
                    type='button'
                  >
                    <span className='project-picker-option-label'>{projectLabel(recentPath)}</span>
                    <span className='project-picker-option-path'>{recentPath}</span>
                  </button>
                ))}
              </div>
            </section>
          )
          : <p className='directory-picker-empty'>No recent projects yet.</p>}
        <div className='modal-actions'>
          <button onClick={onClose} type='button'>Cancel</button>
        </div>
      </section>
    </div>
  )
}

function FolderIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.7'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8A1.5 1.5 0 0 1 20.5 8.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z' />
    </svg>
  )
}
