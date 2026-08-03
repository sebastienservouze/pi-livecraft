# Pi extensions

These extensions are loaded into every persistent Pi session started by Pi Livecraft. Disposable isolated prompts disable extensions unless their caller explicitly supplies paths:

- `ask-user-question.ts` registers the structured questionnaire tool and bridges its versioned payload through Pi's extension UI protocol.
- `quotas.ts` registers the private `/livecraft-quotas` command and publishes normalized provider usage through a versioned status payload.

`server/pi-process.ts` owns the extension paths. These modules use Pi's public extension API and shared protocols only; they do not define Pi Livecraft HTTP routes.

For requests displayed in the browser, keep the versioned payload parser in `shared/` and the UI-specific recognition and response flow in [`src/features/dialogs/`](/src/features/dialogs/README.md).

## Add an extension

Implement the smallest capability with Pi's public extension API, then add its path to the persistent-session arguments in `server/pi-process.ts`. Persistent sessions receive the extensions listed there; isolated prompts remain extension-free unless their caller explicitly supplies paths. Keep the extension independent of browser APIs and HTTP routing.

Use [Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md) for public RPC commands and session data. Use [Run an isolated prompt](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md) when the work must not affect the current session. If an extension emits browser UI, follow the [dialog contract](/src/features/dialogs/README.md) and validate a versioned payload in `shared/` rather than interpreting extension-specific data ad hoc in React.
