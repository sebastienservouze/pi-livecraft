# Project architecture

`hermes-pi-coding-ui-plugin` separates the Hermes dashboard plugin UI, local HTTP API, and Pi processes so rebuilding the plugin or restarting the backend does not close active sessions.

```text
Hermes dashboard (host page)
    │ loads dashboard/dist/index.js + style.css
    ▼
React plugin tab (src/App.tsx …)
    │ HTTP + SSE (absolute backend origin, CORS)
    ▼
server/backend.ts ─── JSON Lines over local TCP ──▶ server/manager.ts ─── Pi public RPC ──▶ pi --mode rpc
                                                        ▲
                                                        │ starts; replaces only after an accepted restart
                                             server/manager-supervisor.ts
```

## Frontend

The UI ships as a **Hermes web dashboard plugin** (`dashboard/manifest.json`, `src/plugin-entry.tsx`, built bundle in `dashboard/dist/`). Hermes injects the bundle and mounts the registered component as the `/hermes-pi-coding-ui-plugin` tab. React comes from `window.__HERMES_PLUGIN_SDK__.React` through the aliased shims in `src/plugin/`; do not import the npm `react` package from feature code.

`src/App.tsx` remains the cross-cutting orchestrator: it receives the SSE stream, applies effects that span features (dialogs, Git, quotas, notifications, and manager state), and connects the panels. Workspace/session lifecycle belongs to `useWorkspaceSessions`; selected-conversation snapshots, replay, streaming, and tool execution state belong to `useConversationRuntime`. Area-specific logic and rendering live in `src/features/`:

- `composer/` — input, commands, and image preparation;
- `conversation/` — history, activity, usage, and tool calls;
- `dialogs/` — extension questionnaires and dialogs;
- `git/` — Git widget state and diffs;
- `manager/` — persistent runtime update and restart notice;
- `right-sidebar/` — integrated widgets, rail actions, collapse state, and resizing;
- `workspace/` — directory selection and recent sessions.

Use the [`src/features/` map](/src/features/README.md) to locate frontend ownership. Features with non-obvious contracts add a short README beside their code rather than expanding this system overview.

`src/api.ts` is the frontend's only HTTP and SSE boundary. It resolves the backend base URL (default `http://127.0.0.1:43121`, overridable in Settings → Backend connection) and owns request encoding, error conversion, manager-event parsing and validation, and the `EventSource` subscription while leaving native reconnection intact. A component does not communicate directly with the manager or a Pi process.

All plugin CSS is scoped under `.app-shell` so injected styles do not repaint the Hermes dashboard chrome. `src/App.css` orders the stylesheets. Global and responsive rules live in `src/styles/`; feature-specific rules are colocated with their feature.

## Backend and manager

`server/backend.ts` exposes the web API, validates HTTP requests, enables CORS for the Hermes dashboard origin, and broadcasts SSE events. It no longer serves a standalone SPA build. Domain behavior for Git, quotas, terminal launching, and todos lives in `server/features/`; route definitions remain in the backend. Other neighboring modules provide workspace files, recent sessions, and system integrations.

`server/manager.ts` is the sole owner of `pi --mode rpc` processes. `server/pi-process.ts` starts them with the extensions from `pi-extensions/`, while `server/manager-client.ts` carries backend requests over local JSON Lines. Keeping this ownership outside the backend preserves Pi sessions across backend restarts.

`server/manager-supervisor.ts` starts the manager with the SHA-256 revision of the files declared in `server/manager-runtime-files.json`. It never replaces the manager because files changed or because it crashed: replacement happens only when the manager accepts a restart request and exits with the reserved code. After a crash, the supervisor stays alive and the backend reports the outage.

`server/manager-runtime-monitor.ts` runs in the backend. It compares the running revision with the current declared files, emits `manager_status` through SSE, and coordinates the guarded restart. The manager reconciles live Pi state and rejects the restart while work is active; the monitor rejects concurrent restart requests. Once accepted, the manager closes its Pi children before the supervisor starts the replacement; closed idle sessions remain available in history. The focused [manager lifecycle guide](/docs/MANAGER-LIFECYCLE.md) documents this contract and its validation.

## Shared contracts

`shared/` contains types and protocols exchanged between layers. HTTP, SSE, manager, and RPC formats are observable contracts: an internal move must not change them implicitly.

## Main flows

1. Hermes loads the plugin bundle and mounts `App`.
2. The plugin calls a function from `src/api.ts` against the configured backend origin.
3. `server/backend.ts` validates the request and handles local capabilities directly, or forwards it to the manager.
4. The manager creates, reopens, or commands the relevant Pi process.
5. Pi events travel back to the backend and then to the plugin through SSE.
6. `App` updates cross-cutting state and delegates rendering to the relevant feature.

## Where to make a change

- Hermes plugin packaging or registration: `dashboard/manifest.json`, `src/plugin-entry.tsx`, `vite.config.ts`.
- New contextual message or tool call action: compose it in `DefaultMessageCard` or `ToolCallCard` and reuse the conversation action styles; follow [`HOW-TO-CONVERSATION-ACTION.md`](/docs/HOW-TO-CONVERSATION-ACTION.md).
- New tool presentation: `src/features/conversation/tool-call-presentations/<tool>.ts`, register in `index.ts`, then its focused test.
- New conversation or composer behavior: the relevant feature, without growing `App` when the state is not cross-cutting.
- New palette command, widget command, or shortcut: read [`../src/features/commands/README.md`](/src/features/commands/README.md).
- New preference or persisted UI state: read [`../src/features/settings/README.md`](/src/features/settings/README.md).
- New right widget: read [`../src/features/right-sidebar/README.md`](/src/features/right-sidebar/README.md).
- Existing local capability: its module under `server/features/`, after reading [`../server/features/README.md`](/server/features/README.md).
- New local route: `server/backend.ts`, then `src/api.ts` if the frontend uses it.
- Manager or Pi process behavior: `server/manager.ts` or `server/pi-process.ts`; keep `server/manager-runtime-files.json` aligned with runtime imports.
- Manager supervision or restart protocol: `server/manager-supervisor.ts` and `server/manager-runtime-monitor.ts`, after explicit approval because this changes the interruption boundary.
