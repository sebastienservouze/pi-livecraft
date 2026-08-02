# Terminal backend capability

`launcher.ts` opens an external terminal application in a validated workspace directory. An empty command selects the platform default: Linux uses `x-terminal-emulator`, WSL preserves its distribution through Windows Terminal, and native Windows tries Windows Terminal in a new window, Alacritty, WezTerm, PowerShell 7, Windows PowerShell, then Command Prompt.

Console-shell targets use the required built-in Windows PowerShell broker, hidden only while it starts the visible terminal. A custom command is a validated `{cwd}` template and is never passed through a shell. Double quotes group arguments; Windows path backslashes remain literal, doubled quotes produce a literal quote, and the existing `\"` quoted-literal form remains supported. Outside quotes, a backslash escapes only whitespace or a quote. A custom-command failure is reported directly instead of falling back to a different terminal.

HTTP routing and working-directory resolution remain in `server/backend.ts`. Main coverage: `test/terminal-launcher.test.ts`.
