# Terminal and folder actions

These are direct workspace actions rather than panel widgets. Selecting them leaves the conversation where it is and opens either Hermes dashboard pages or an OS application.

## Where they are available

- from the right rail;
- from the command palette;
- from the editable shortcuts (`Open terminal` defaults to `Alt+T`, `Open folder in explorer` to `Alt+O`).

## Hermes dashboard (default remote path)

When the tab runs inside `hermes dashboard`, the actions navigate in-browser:

- **Open folder** → Hermes **Files** (`/files`);
- **Open terminal** → Hermes **Chat** (`/chat`, embedded PTY terminal).

They do not spawn desktop apps on the server. That matches how Hermes itself exposes files and terminal over the network.

## Direct / local backend

When the plugin is not hosted by Hermes (for example a loopback backend during development), the backend launches an external OS application in the workspace:

- Linux tries `x-terminal-emulator`, then Raspberry Pi / desktop fallbacks (`lxterminal`, `gnome-terminal`, `xfce4-terminal`, `konsole`, `mate-terminal`, `xterm`) and requires a graphical session (`DISPLAY` or `WAYLAND_DISPLAY`);
- macOS opens Terminal.app at the workspace path via `open -a Terminal`;
- WSL uses `wt.exe`, preserves the current distribution when available, and opens at the workspace path;
- native Windows tries Windows Terminal, Alacritty, WezTerm, PowerShell 7, Windows PowerShell, then Command Prompt, stopping at the first launcher that starts successfully.

Open folder uses `xdg-open` / `pcmanfm` / similar on Linux, `open` on macOS, and Explorer on Windows/WSL.

A custom terminal command can be entered in Settings for the local OS path. It must contain `{cwd}`. The template is parsed as a command and arguments, never passed through a shell.

## Ownership and data flow

`App.tsx` exposes the rail actions and palette commands. Hermes vs OS routing lives in `hermes-host-actions.ts`. Browser requests for OS launchers go through `src/api.ts` to the [terminal backend capability](/server/features/terminal/README.md).

Focused coverage: `test/hermes-host-actions.test.ts`, `test/terminal-launcher.test.ts`.
