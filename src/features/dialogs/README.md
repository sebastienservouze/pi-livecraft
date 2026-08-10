# Extension dialogs

This feature presents UI requests emitted by Pi extensions and sends their responses back to the
owning session. `App.tsx` owns the cross-session queue and decides which request is visible;
`Dialogs.tsx` owns rendering and response state for the selected request.

## Protocol boundary

- `App.tsx` receives `extension_ui_request` events and retains pending requests by session.
- `dialog-protocol.ts` recognizes supported request shapes and identifies blocking dialogs.
- `Dialogs.tsx` responds through `sendPiCommand(..., { type: 'extension_ui_response', ... })`.
- Generic Pi extension requests keep their public RPC fields. The plugin questionnaire uses the
  versioned parser in `shared/ask-user-question.ts`.
- `pi-extensions/ask-user-question.ts` creates that questionnaire payload; browser-specific logic
  must not move into the extension.

Unknown or malformed specialized payloads must not be treated as questionnaires. Keep validation
in the shared parser so the extension and frontend agree on the same versioned contract. Main
coverage: `test/ask-user-question.test.ts`.

## Build on the dialog system

Use Pi's existing generic `select`, `confirm`, `input`, and `editor` requests when they fit; `dialog-protocol.ts` already recognizes them and `Dialogs.tsx` renders them. A new specialized presentation is justified only when its payload or interaction cannot use those public fields.

For a specialized request, define and validate a versioned payload in `shared/`, recognize it in `dialog-protocol.ts`, compose its UI in `Dialogs.tsx`, and return the result through the existing `extension_ui_response` command. The producing extension and frontend must share the parser, and parser coverage must include malformed and unsupported versions. Keep queue ownership in `App.tsx` and browser-specific behavior out of `pi-extensions/`.
