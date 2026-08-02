# Terminal backend capability

`launcher.ts` opens an external terminal application in a validated workspace directory. An empty command selects the Linux, WSL, or native Windows default; Windows tries Windows Terminal before PowerShell. A custom command is a validated template with a `{cwd}` placeholder.

HTTP routing and working-directory resolution remain in `server/backend.ts`. Main coverage: `test/terminal-launcher.test.ts`.
