# How to run an isolated prompt

`runPrompt()` executes a prompt in a disposable Pi process without touching
the active session. The process starts, runs the prompt, extracts the
assistant's response, and terminates — no messages, tool calls, or state leak
into the current conversation.

> Each isolated prompt runs with its own dedicated Pi profile under the user's
> home directory (`.pi/livecraft-isolated`; for example,
> `C:\Users\Ada\.pi\livecraft-isolated` on Windows). Pi may persist its model and
> thinking defaults there, but those writes never reach your main Pi configuration.
> The defaults you see in new sessions stay exactly as you left them.

Use it when you need a quick Pi query from a widget, command, or UI element
without side effects on the session.

## The flow

```
src/api.ts: runPrompt(sessionId, options)
    │  POST /api/sessions/:id/run-prompt
    ▼
server/backend.ts   (validates prompt, forwards options)
    │  manager.request({ action: 'run_prompt', ... })
    ▼
server/manager.ts   (resolves cwd from session, delegates)
    │
    ▼
server/run-isolated-prompt.ts
    │  PiProcess(isolated: true, PI_CODING_AGENT_DIR=<home>/.pi/livecraft-isolated, ...)
    │  → set_model (or auto-select cheapest)
    │  → prompt
    │  → wait agent_settled
    │  → get_messages → extract assistant text
    │  → terminate
    ▼
Assistant text (string)
```

## Signature

```ts
import { runPrompt, type RunPromptOptions } from './api.ts'

const text: string = await runPrompt(sessionId, options)
```

### `RunPromptOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | **required** | The prompt sent to the model |
| `systemPrompt` | `string` | `undefined` | System prompt for the disposable session |
| `thinkingLevel` | `string` | `'off'` | `'off'`, `'low'`, `'medium'`, or `'high'` |
| `model` | `{ provider, modelId }` | auto (cheapest) | Model to use; omit for cheapest available |
| `extensions` | `string[]` | `undefined` | Extension paths to load; omit to disable all |
| `tools` | `string[]` | `undefined` | Tool names to load; omit to disable all |
| `includeContextFiles` | `boolean` | `true` | Whether Pi loads `AGENTS.md`/`CLAUDE.md` from parent directories. Set `false` to disable automatic context and provide your own via `systemPrompt`. |

## Examples

### Simple classification

```ts
const sentiment = await runPrompt(sessionId, {
  prompt: 'Classify: "This update broke production." → positive, negative, neutral. Output one word.',
  thinkingLevel: 'off',
})
// → "negative"
```

### With a custom system prompt and model

```ts
const summary = await runPrompt(sessionId, {
  prompt: 'Summarize the following diff in one sentence:\n' + diffText,
  systemPrompt: 'You are a code reviewer. Be precise and concise.',
  model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  thinkingLevel: 'low',
})
```

### With tools enabled

```ts
const result = await runPrompt(sessionId, {
  prompt: 'Read package.json and tell me the project name.',
  tools: ['read'],
})
```

### With custom context files disabled

```ts
const result = await runPrompt(sessionId, {
  prompt: 'Analyze this code.',
  systemPrompt: `${mySystemPrompt}\n\n<project_map>\nsrc/\n  main.ts\n</project_map>`,
  includeContextFiles: false,
})
```

> **Note:** `--system-prompt` alone does not stop Pi from loading
> `AGENTS.md`/`CLAUDE.md`. The context files are appended *after* the
> system prompt. To provide your own context (e.g. a project map) without
> automatic injection, set `includeContextFiles: false`.

## When to use

- Quick classification, extraction, or transformation from a widget or command
- One-shot queries that shouldn't appear in the session history
- Short tasks that don't need the full agent loop (tools, follow-ups)
- Testing prompts without cluttering the conversation

## When NOT to use

- Multi-turn conversations → use the active session with `sendPiCommand`
- Tasks needing user interaction (confirmations, file picks) → the isolated
  process has no UI bridge
- Long-running work → the process is terminated after the first response
- Streaming output → only the final text is returned

## Related

- [Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md) — send arbitrary RPC commands to the
  active session
- [Add a widget](/docs/HOW-TO-WIDGET.md) — use `runPrompt` from a sidebar widget
- [Add a palette command](/docs/HOW-TO-PALETTE-COMMAND.md) — use `runPrompt` from a
  command handler
