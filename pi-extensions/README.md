# Pi extensions

Persistent Pi sessions retain Pi's ambient personal and project extension discovery, and explicitly load the non-colliding `quotas.ts` bridge. Disposable isolated prompts disable extensions unless their caller explicitly supplies paths:

- `quotas.ts` registers the private `/livecraft-quotas` command and publishes normalized provider usage through a versioned status payload.

`ask-user-question.ts` remains available for opt-in use, but is not loaded automatically because an ambient extension may already register the same tool.

`server/pi-process.ts` owns the extension paths. These modules use Pi's public extension API and shared protocols only; they do not define Pi Livecraft HTTP routes.

For requests displayed in the browser, keep the versioned payload parser in `shared/` and the UI-specific recognition and response flow in [`src/features/dialogs/`](/src/features/dialogs/README.md).

## Add an extension

Implement the smallest capability with Pi's public extension API. Persistent sessions retain ambient extension discovery and explicitly load only the namespaced `quotas.ts` bridge; isolated prompts remain extension-free unless their caller explicitly supplies paths. Keep the extension independent of browser APIs and HTTP routing.

Use [Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md) for public RPC commands and session data. Use [Run an isolated prompt](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md) when the work must not affect the current session. If an extension emits browser UI, follow the [dialog contract](/src/features/dialogs/README.md) and validate a versioned payload in `shared/` rather than interpreting extension-specific data ad hoc in React.
