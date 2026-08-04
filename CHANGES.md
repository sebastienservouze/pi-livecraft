# Livecraft UI overhaul — project-scoped session browser (GH-519)

Branch: `livecraft-ui-gh519` (isolated clone at `/private/tmp/livecraft-gh519`, cloned from
`/Users/pixexid/Projects/pi-livecraft`). No push to origin; local commits only.

Implements the six target behaviors from pixexid/llm-collab#519: worker-first thread names,
project/repository grouping, an explicit project picker, per-project divider actions, a Skills &
Extensions inventory in Settings, and a hideable sidebar.

## How each acceptance criterion is met

1. **No newly created thread displays a generic or blank title.**
   `src/features/composer/prompt-title.ts` gained `composeThreadTitle` + `displayThreadTitle`.
   Stored session names are always plain context (first prompt or Pi-generated title); the current
   worker (`session.activeAgent`, else the `Pi` default from `shared/session-names.ts`) is composed
   in at render time in `WorkspaceSidebar`. `displayThreadTitle` maps any generic/blank sentinel
   (`Nouvelle session`, `New session`, empty) to a worker-only title, so a fresh thread renders
   `Pi` / `glmpi — …` immediately — including during the first-prompt/title-extension race. Later Pi
   renames replace only the context because the worker is always re-applied. The backend/`App`
   sentinel is unified in `shared/session-names.ts` (`unnamedSessionName`), consumed by
   `server/manager.ts`, `server/pi-session-store.ts`, `useWorkspaceSessions.ts`, and `App.tsx`.
   *Verified in browser:* every thread rendered `Pi — Automated llm-collab worker provisioning…`.

2. **Two projects remain visibly separated and independently actionable after refresh.**
   New pure module `src/features/workspace/sidebar-projects.ts` (`groupProjects`) groups sessions by
   **canonical workspace path** (never a display label). The active workspace always renders (even
   empty); other projects render from live sessions; pinned projects always render. Ordering: pinned
   → active workspace → most-recent activity (stable across refreshes). `WorkspaceSidebar` renders a
   divider per project with label + thread/active-count summary.
   *Verified in browser:* pinned `nuvyr_app` (0 threads) and `llm-collab` (30 threads) rendered as
   two independent sections; pin state persisted across reload.

3. **Project selection is explicit, searchable, keyboard accessible, and identity-safe.**
   `DirectoryPicker.tsx` became an explicit **Switch project** picker: a "Current project" panel, a
   searchable path/label filter over registered recent projects, existing Tab/↑↓/Enter/Escape
   keyboard completion, and local-worktree path completion. Selection always re-validates through
   `listDirectories` and adopts the **canonical** returned path.
   *Verified in browser:* picker showed current selection, keyboard hints, and worktree completion.

4. **Archive/pin/new-thread actions work from the project divider without changing another project.**
   Divider actions (revealed on hover **and** keyboard focus-within, kept in the tab order via
   `opacity`) are scoped to the exact project path: **New thread**, **Pin/Unpin**, **Archive**, and
   an **overflow** menu (**Open folder**). Pin/archive persist in `localStorage` keyed by canonical
   path (`project-preferences.ts` + `App` storage helpers). Archive is recoverable through the
   "Archived projects (N)" footer (Restore), and switching to a project always un-archives it.
   *Verified in browser:* action `aria-label`s were scoped per project (`Pin llm-collab`,
   `Unpin nuvyr_app`, `Archive …`, `More actions for …`).

5. **Skills/extensions are visible in Settings with truthful loading/error states.**
   New read-only backend route `GET /api/capabilities?cwd=…` (`server/capabilities.ts`, added to
   `server/backend.ts`) discovers Pi skills (`<agentDir>/skills`, `<cwd>/.pi/skills`) and extensions
   (`<agentDir>/extensions`, `<cwd>/.pi/extensions`). It is **bounded** (≤200 entries/surface, ≤64
   KiB per file read) and **fails closed**: a missing root is a legitimate empty list, but any other
   read failure populates a per-surface `skillsError`/`extensionsError` instead of a false-empty
   list. `SettingsPanel.tsx` adds **Skills** and **Extensions** tabs with search, refresh, and
   loading/error/empty states, showing name, enabled badge, scope/origin, path, and commands/tools
   where known. Open-folder reuses the existing `openExplorer` system-integration path.
   Enable/disable is presented read-only (see Deferred gaps).
   *Verified in browser:* Skills showed `browser-tools` + `creatorskill` (Enabled, real paths);
   Extensions showed `pi-smart-voice-notify` (Enabled); no false error.

6. **Sidebar collapse/restore is accessible, persistent, and does not interrupt the active session.**
   `App.tsx` adds collapse state persisted via `workspaceSidebarCollapsedKey` (in
   `workspace-sidebar.ts`, beside the width preference). A labeled toggle (`aria-expanded`) sits at
   the top-left, plus a `⌘B`/`Ctrl+B` shortcut. Collapsed, the sidebar becomes a slim rail
   (expand / new-thread / settings) while the conversation column keeps its width via
   `.app-shell.sidebar-collapsed` grid rules (`base.css`, `responsive.css`). Collapse never touches
   session state.
   *Verified in browser:* collapse → rail; state persisted across a full reload; expand restored.

## Files changed

New:
- `shared/session-names.ts` — shared `unnamedSessionName`, `defaultWorkerName`, `isGenericSessionName`.
- `server/capabilities.ts` — bounded, fail-closed skill/extension discovery.
- `src/features/workspace/sidebar-projects.ts` — pure grouping/pin/archive/ordering.
- `src/features/workspace/project-preferences.ts` — pure pin/archive storage keys + `toggleProjectPath`.
- `test/capabilities.test.ts`, `test/sidebar-projects.test.ts`, `test/project-preferences.test.ts`.

Modified:
- `shared/types.ts` — `CapabilityEntry` / `CapabilityInventory`.
- `server/backend.ts` — `GET /api/capabilities` route.
- `server/manager.ts`, `server/pi-session-store.ts` — worker-first naming fallback via shared sentinel.
- `server/manager-runtime-files.json` — declares `shared/session-names.ts` (manager runtime manifest).
- `src/api.ts` — `listCapabilities(cwd)`.
- `src/features/composer/prompt-title.ts` — `composeThreadTitle` / `displayThreadTitle`.
- `src/features/workspace/WorkspaceSidebar.tsx` — project sections, divider actions, collapsed rail, archived footer.
- `src/features/workspace/DirectoryPicker.tsx` — explicit searchable project picker.
- `src/features/workspace/useWorkspaceSessions.ts` — shared sentinel + naming import.
- `src/features/workspace/workspace-sidebar.ts` — collapse persistence helper.
- `src/features/settings/SettingsPanel.tsx` — Skills/Extensions tabs + capability list.
- `src/App.tsx` — grouping memo, project/collapse state + handlers, `⌘B`, wiring.
- CSS: `workspace.css`, `settings.css`, `styles/base.css`, `styles/responsive.css`.
- `vite.config.ts` — `PI_LIVECRAFT_FRONTEND_PORT` pin (port seam from the live checkout).
- `test/prompt-title.test.ts` — added compose/display coverage.

## Test results

Focused unit tests (Node 24 `node --test`): **39 pass / 0 fail** across `prompt-title`,
`sidebar-projects`, `project-preferences`, `sidebar-sessions`, `workspace-sidebar`, `capabilities`,
`manager-runtime`, `recent-workspaces`, `session-indicator`.

- `npx tsc -b` — clean (exit 0).
- `npm run build` — succeeds (pre-existing >500 KiB chunk-size warning only).
- `npx dprint check` — clean.
- `npx oxlint` — no errors (2 pre-existing warnings: a fast-refresh note on `settingsTabs` and an
  intentional `exhaustive-deps` on the DirectoryPicker completion effect, both present before this work).

Not run: the full `node --test` suite hangs on the Pi RPC/manager **integration** tests (they spawn a
real `pi` binary). Three `pi-session-store` unit tests and the `git` worktree / `pi.cmd` launcher
tests fail on this machine **independently of this branch** (confirmed by stashing my
`pi-session-store` change — still 3/4 fail): a macOS `/var`↔`/private/var` realpath quirk in the temp
fixtures. No new failures were introduced.

## Browser smoke pass

Ran the isolated stack on **free ports 43230 (manager) / 43231 (backend) / 43232 (frontend)** via
`PI_LIVECRAFT_MANAGER_PORT/…_BACKEND_PORT/…_FRONTEND_PORT` + `npm run dev`. The live LaunchAgent
service on 43120–43122 was **not bound**. Verified all six behaviors (details inline above): two
grouped projects, worker-first names, project picker with current selection + worktree completion,
per-project scoped divider actions, Settings Skills/Extensions real inventory, and collapse/restore
persisting across reload. Dev server stopped afterward.

**Operational note (honest disclosure):** during teardown, a broad `pkill -f
"server/manager-supervisor.ts"` matched the live checkout's manager as well as my isolated one and
briefly interrupted the live service. It is LaunchAgent-managed with KeepAlive and **auto-recovered
within seconds** (all three live ports confirmed listening again; any active Pi worker sessions that
were attached to the old manager would need re-waking). Teardown should have used only the
port-scoped kills (43230–43232), which had already succeeded. No files in the live checkout were
touched.

## How to run / preview

Node 24 required:

```sh
export PATH=/Users/pixexid/.nvm/versions/node/v24.18.1/bin:$PATH
cd /private/tmp/livecraft-gh519
npm install
# Use free ports so the live service on 43120-43122 is untouched:
PI_LIVECRAFT_MANAGER_PORT=43230 \
PI_LIVECRAFT_BACKEND_PORT=43231 \
PI_LIVECRAFT_FRONTEND_PORT=43232 \
npm run dev
# open http://127.0.0.1:43232/
```

Tests: `npm test` runs the full suite (integration tests need a real `pi` binary and may hang);
prefer the focused list:
`node --test test/prompt-title.test.ts test/sidebar-projects.test.ts test/project-preferences.test.ts test/capabilities.test.ts test/workspace-sidebar.test.ts`.

## Deferred gaps

- **Cross-project history threads.** `GET /api/sessions/recent` returns only the active workspace's
  history, so non-active projects show only their live/attention sessions plus any pinned (possibly
  empty) section — full per-project history lists across all projects would need a backend change and
  were left out of this UI lane.
- **Skill/extension enable/disable is read-only.** Live toggling would mutate Pi's configuration,
  which #519 and the lane scope place out of bounds (backend limited to the naming fallback + the
  read-only discovery route). Enabled state is shown truthfully; open-folder is wired.
- **`⌘B` is a dedicated listener**, not a remappable entry in the command-shortcut registry, to avoid
  touching `command-registry.ts` and its conflict logic/tests.
