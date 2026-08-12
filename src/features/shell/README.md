# Terminal

The terminal runs in the browser tab. `ShellPanel.tsx` streams a shell that lives on the backend host, so it works from any machine that can reach the Hermes dashboard and needs no desktop session on the server.

- `ShellPanel.tsx` owns the panel: it creates the session, subscribes to its output, and sends input.
- `terminal-output.ts` turns raw shell bytes into styled lines. It tracks cells per column, so carriage returns overwrite in place and escape sequences never leak into the text.
- `shell-session-store.ts` remembers the open session so collapsing the panel does not end it. Switching workspace closes the previous shell.

Input is sent line by line: <kbd>Enter</kbd> sends the typed line, <kbd>↑</kbd> and <kbd>↓</kbd> recall earlier lines, and <kbd>Ctrl</kbd>+<kbd>C</kbd>, <kbd>Ctrl</kbd>+<kbd>D</kbd>, and <kbd>Ctrl</kbd>+<kbd>L</kbd> are forwarded as control characters. The rail button, the `Open Terminal` palette command, and <kbd>Alt</kbd>+<kbd>T</kbd> all open this panel.

Requests go through `src/api.ts` (`createShellSession`, `sendShellInput`, `subscribeShellOutput`, `closeShellSession`) to the [shell backend capability](/server/features/shell/README.md). Focused coverage: `test/terminal-output.test.ts`.
