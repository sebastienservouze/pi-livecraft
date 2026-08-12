# Frontend features

Start with the area that owns the behavior. Read `App.tsx` only when state coordinates several areas; browser-to-backend calls always go through `src/api.ts`.

## Conversation loop

- `workspace/` selects directories and creates, reopens, or switches sessions. See [workspace and sessions](/src/features/workspace/README.md).
- `composer/` prepares prompts, images, slash commands, and per-session drafts. See [composer](/src/features/composer/README.md).
- `conversation/` owns the selected session's snapshot, live-event replay, streaming state, activity, usage, tool calls, file previews, and contextual message/tool actions. See [conversation](/src/features/conversation/README.md), [conversation actions](/docs/HOW-TO-CONVERSATION-ACTION.md), and [tool presentations](/docs/HOW-TO-TOOL-PRESENTATION.md).
- `dialogs/` handles generic Pi UI requests and versioned specialized requests sent by Pi extensions. See [extension dialogs](/src/features/dialogs/README.md).

## Application controls

- `commands/` owns the command registry, palette, and keyboard normalization. See [commands](/src/features/commands/README.md).
- `settings/` edits local preferences exposed to the user. See [settings and preferences](/src/features/settings/README.md).
- `notifications/` displays transient notices and persistent errors. See [notifications](/src/features/notifications/README.md).
- `manager/` reports manager runtime changes and offers the [guarded manual restart](/src/features/manager/README.md).
- `right-sidebar/` composes workspace widgets and rail actions. See [right sidebar](/src/features/right-sidebar/README.md).

## Workspace widgets

- `explorer/`, `git/`, `quotas/`, `session-analysis/`, `shell/`, and `todo/` each keep their rendering and local state within their directory.
- Their README files name the data owner, invariants, backend counterpart when one exists, and focused tests.

Read the [project architecture](/docs/ARCHITECTURE.md) only when a change crosses the frontend, HTTP API, manager, or Pi process boundaries.
