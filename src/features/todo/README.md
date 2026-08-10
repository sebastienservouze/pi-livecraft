# Todo widget

The Todo widget is a small task list attached to the current workspace. It keeps unfinished ideas close to the conversation without turning them into Pi instructions until the user explicitly starts a session.

The rail badge shows the number of open tasks. Each workspace has its own list and its own unfinished input draft.

## What you can do

- add, edit, complete, and delete tasks;
- drag open tasks into a deliberate order;
- keep a partially typed task across page reloads;
- open a new Pi session with the task text ready to edit;
- open a new session and send the task to Pi immediately;
- return to a session that was created from a task.

Completing a task removes it from the visible open list and updates the rail count. Deleting a task is immediate and does not show a confirmation dialog.

## Session links

Starting work from a task stores a link between that task and the new Pi session. The row then shows the session name and its current activity state instead of the two launch actions. Selecting the row navigates back to that session.

If the session is renamed elsewhere in the UI, the linked task follows the new name. The task itself remains under the user's control and is not completed automatically when Pi stops.

## Persistence and ownership

`TodoWidget` owns loading, editing, drag ordering, the local input draft, and session links. All task-list reads and writes pass through `src/api.ts` to the [todos backend capability](/server/features/todos/README.md).

The backend validates and atomically stores each ordered list by canonical workspace path. Stable identifiers preserve task and session links across edits. The unsaved input draft stays in browser `localStorage` under a workspace-specific key.

Focused coverage: `test/todo-order.test.ts` and `test/todo-store.test.ts`.
