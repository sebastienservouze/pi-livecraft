# How to talk to Pi

Every interaction with a Pi session goes through the same tunnel. This guide
explains how to reach Pi from plugin code and where to find the full
protocol reference.

## The tunnel

```
src/api.ts  →  HTTP POST /api/sessions/:id/commands
                   │
           server/backend.ts   (validates type: string)
                   │
           server/manager.ts   (forwards to the right PiProcess)
                   │
           pi --mode rpc       (JSON Lines over stdin/stdout)
```

No command whitelist or semantic filter is applied. The backend only checks that the body has a
`type` string of at most 100 characters. Everything else is forwarded as-is to the manager and Pi.

## Two ways to reach Pi

### 1. Snapshot — selection and event reconciliation

The frontend calls `getSnapshot(sessionId)` when a session is selected and when Pi events require
history reconciliation. Each request triggers five Pi commands in parallel inside
`server/backend.ts`:

| Command | Returns |
|---|---|
| `get_state` | Current model, thinking level, streaming status, session name |
| `get_entries` | Entries used by the backend to rebuild the visible active conversation |
| `get_available_models` | `Model[]` — id, provider, cost, context window, input types |
| `get_commands` | Available extensions, prompt templates, and skills |
| `get_session_stats` | Token usage, total cost, context window pressure |

The backend follows the active entry branch, keeps user, assistant, tool-result, and explicitly
visible custom messages, and represents compactions as visible custom messages. It then assembles
the result into a `SessionSnapshot` and sends it to the frontend as JSON. These five commands are
the only ones called as part of snapshot refreshes; you never need to invoke them yourself.

### 2. Arbitrary commands — on demand

Call `sendPiCommand(sessionId, command)` from `src/api.ts` with any command
object that Pi's RPC protocol accepts:

```ts
import { sendPiCommand } from '../api.ts'

// Switch model
await sendPiCommand(sessionId, { type: 'set_model', provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' })

// Set thinking level
await sendPiCommand(sessionId, { type: 'set_thinking_level', level: 'high' })

// Manual compaction
await sendPiCommand(sessionId, { type: 'compact' })

// Any other RPC command
```

The function returns the raw Pi response (`{ success: boolean, data?: unknown,
error?: string }`). There is no typed wrapper — the response shape depends on
the command.

Commands already wired in the UI (`prompt`, `steer`, `follow_up`, `abort`,
`set_model`, `set_thinking_level`) go through the same `sendPiCommand`
function, called from the feature that needs them.

## Key data shapes

### Model

```ts
{
  id: string              // API model identifier
  name?: string           // Human-readable label
  provider: string        // e.g. "anthropic", "openai"
  reasoning: boolean
  input: string[]         // e.g. ["text"] or ["text", "image"]
  contextWindow: number   // tokens
  maxTokens: number
  cost: {
    input: number         // per million tokens
    output: number
    cacheRead: number
    cacheWrite: number
  }
}
```

Models arrive in `snapshot.models` (typed as `JsonObject[]`). Access fields
with guards or casts — the plugin keeps the type loose to avoid coupling to
Pi's schema.

### Session stats

```ts
{
  tokens: { input, output, cacheRead, cacheWrite, total }
  cost: number            // total USD
  contextUsage: {
    tokens: number
    contextWindow: number
    percent: number
  }
}
```

Available as `snapshot.stats`.

## Full protocol reference

Everything Pi accepts and emits is documented in the RPC protocol guide
shipped with your Pi installation:

```
$(npm root -g)/@earendil-works/pi-coding-agent/docs/rpc.md
```

That guide covers all 30+ commands, the complete event stream, extension UI
sub-protocol, and every field on every response. Use it as the authoritative
source — this document only describes how the plugin routes commands, not what
each command does.
