import { useCallback, useEffect, useState } from 'react'
import { getWorkspaceFile, listWorkspaceEntries } from '../../api.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { WorkspaceEntries } from '../../../shared/types.ts'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'

interface FilePreview {
  relativePath: string
  content: string
}

/** Browses the workspace on the backend host and previews text files in the panel. */
export function ExplorerPanel(
  { workspacePath, onError }: { workspacePath: string; onError: (message: string) => void },
) {
  const [directory, setDirectory] = useState<WorkspaceEntries | null>(null)
  const [relativePath, setRelativePath] = useState('')
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)

  const report = useCallback(
    (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)),
    [onError],
  )

  useEffect(() => {
    setRelativePath('')
    setPreview(null)
  }, [workspacePath])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listWorkspaceEntries(workspacePath, relativePath)
      .then((entries) => {
        if (!cancelled) setDirectory(entries)
      })
      .catch((cause) => {
        if (cancelled) return
        report(cause)
        // A vanished directory must not leave the panel stuck on it.
        if (relativePath !== '') setRelativePath('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [relativePath, reloadCount, report, workspacePath])

  function openFile(path: string): void {
    void getWorkspaceFile(workspacePath, path)
      .then((file) => setPreview({ relativePath: path, content: file.content }))
      .catch(report)
  }

  const segments = relativePath === '' ? [] : relativePath.split('/')

  return (
    <WidgetLayout
      header={
        <>
          <div>
            <strong>Files</strong>
            <span>{preview ? preview.relativePath : relativePath || 'Workspace root'}</span>
          </div>
          {preview
            ? (
              <Tooltip label='Back to files'>
                <button
                  aria-label='Close the file preview'
                  onClick={() => setPreview(null)}
                  type='button'
                >
                  ✕
                </button>
              </Tooltip>
            )
            : (
              <Tooltip label='Refresh'>
                <button
                  aria-label='Refresh the file list'
                  onClick={() => setReloadCount((count) => count + 1)}
                  type='button'
                >
                  ↻
                </button>
              </Tooltip>
            )}
        </>
      }
    >
      {preview
        ? <pre className='explorer-preview'>{preview.content}</pre>
        : (
          <div className='explorer-browser' aria-busy={loading}>
            <nav aria-label='Breadcrumb' className='explorer-breadcrumb'>
              <button onClick={() => setRelativePath('')} type='button'>Workspace</button>
              {segments.map((segment, index) => (
                <button
                  key={segments.slice(0, index + 1).join('/')}
                  onClick={() => setRelativePath(segments.slice(0, index + 1).join('/'))}
                  type='button'
                >
                  {segment}
                </button>
              ))}
            </nav>
            <ul className='explorer-list'>
              {directory?.parentRelativePath !== null && directory && (
                <li>
                  <button
                    onClick={() => setRelativePath(directory.parentRelativePath ?? '')}
                    type='button'
                  >
                    <span aria-hidden='true'>↩</span>
                    <b>..</b>
                  </button>
                </li>
              )}
              {directory?.entries.map((entry) => (
                <li key={entry.relativePath}>
                  <button
                    onClick={() =>
                      entry.kind === 'directory'
                        ? setRelativePath(entry.relativePath)
                        : openFile(entry.relativePath)}
                    type='button'
                  >
                    <span aria-hidden='true'>{entry.kind === 'directory' ? '▸' : '·'}</span>
                    <b>{entry.name}</b>
                    {entry.size !== null && <small>{formatSize(entry.size)}</small>}
                  </button>
                </li>
              ))}
              {directory?.entries.length === 0 && <li className='explorer-empty'>Empty folder</li>}
            </ul>
          </div>
        )}
    </WidgetLayout>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
