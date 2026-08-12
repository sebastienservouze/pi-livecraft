# Files

`ExplorerPanel.tsx` browses the workspace that the backend host sees and previews text files inside the panel, without opening anything on a desktop.

Navigation stays inside the working directory: the panel only sends paths relative to it and the backend rejects anything that resolves outside. Directories are listed before files; a file opens a read-only preview served by the existing `/api/files` route.

The rail button, the `Open Files` palette command, and <kbd>Alt</kbd>+<kbd>O</kbd> open this panel. Requests go through `src/api.ts` (`listWorkspaceEntries`, `getWorkspaceFile`) to the [explorer backend capability](/server/features/explorer/README.md).
