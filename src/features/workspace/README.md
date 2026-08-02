# Workspace and sessions

`useWorkspaceSessions` owns workspace selection and the session lists shown by the application. It coordinates initial selection, refreshes, creation and reopening, optimistic naming, pending UI requests, and the local persistence of recent workspaces and completed sessions.

Keep session-list reconciliation and workspace/session persistence in this controller. `App.tsx` supplies cross-feature callbacks, such as clearing feature state when the workspace changes or preparing an initial composer draft; it should not duplicate the controller's state.

Directory browsing remains in `DirectoryPicker`. Completion accepts POSIX paths, `~/…`, Windows drive letters, and UNC shares while preserving the entered separator style. Pure list and persistence rules live in the neighboring `sidebar-sessions.ts` and `recent-workspaces.ts` modules.
