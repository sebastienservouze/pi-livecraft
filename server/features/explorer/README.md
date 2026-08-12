# Workspace explorer

`workspace-entries.ts` lists one directory for the in-app file browser. `server/backend.ts` owns `GET /api/workspace/entries` and validates the working directory; reading a file keeps using `GET /api/files`.

Listing resolves real paths and refuses anything outside the working directory, so a symbolic link cannot widen what the browser can read. Entries report kind, size, and modification time, with directories first.

Focused coverage: `test/workspace-entries.test.ts`.
