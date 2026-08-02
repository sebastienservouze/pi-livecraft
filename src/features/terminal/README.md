# Terminal action

Terminal is a direct workspace action rather than a panel widget. Selecting it opens an external terminal in the current workspace and leaves the Livecraft conversation where it is.

## Where it is available

- from the right rail;
- from the command palette;
- from the editable `Open terminal` shortcut, which defaults to `Alt+T`.

Launch errors appear as regular Livecraft notifications.

## Launcher selection

With no custom command, the backend chooses the platform launcher:

- Linux uses `x-terminal-emulator` with the workspace as its working directory;
- WSL uses `wt.exe`, preserves the current distribution when available, and opens at the workspace path;
- native Windows tries Windows Terminal, Alacritty, WezTerm, PowerShell 7, Windows PowerShell, then Command Prompt, stopping at the first launcher that starts successfully. Console-shell targets use the required built-in Windows PowerShell broker, hidden only while it starts the visible terminal.

The terminal starts detached from the backend, so it remains an ordinary external application after launch.

A custom command can be entered in Settings. It must contain `{cwd}`, which the backend replaces with the validated workspace path. Double quotes group arguments; doubled quotes and the existing `\"` form produce a literal quote. Windows path backslashes remain literal, while outside quotes a backslash escapes only whitespace or a quote, so quoted drive and UNC executable paths are preserved. The template is parsed as a command and arguments, never passed through a shell. A configured command does not silently fall back when it fails.

## Ownership and data flow

`App.tsx` exposes the rail action, executes the palette command, and stores the custom template in `pi-livecraft.terminal-command`. Browser requests go through `src/api.ts`.

The [terminal backend capability](/server/features/terminal/README.md) validates the workspace and command template before spawning the external application.

Focused coverage: `test/terminal-launcher.test.ts`.
