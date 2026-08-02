# Manager lifecycle

The manager owns every `pi --mode rpc` process and must survive frontend and backend restarts. Its own replacement is therefore explicit: editing manager code never interrupts current work or silently changes the running process.

## Responsibilities

- `server/manager.ts` owns Pi processes, exposes the local JSON Lines protocol, and authoritatively accepts or rejects a restart.
- `server/manager-supervisor.ts` starts one manager and replaces it only after the reserved restart exit code. It does not relaunch crashes.
- `server/manager-runtime.ts` computes the deterministic SHA-256 revision of the declared runtime.
- `server/manager-runtime-monitor.ts` runs with the backend, watches that runtime, publishes `manager_status`, and coordinates restart requests.
- `server/manager-client.ts` reconnects the backend to whichever manager instance is listening.

Process ownership must not move into the backend: doing so would make backend restarts terminate Pi sessions.

## Runtime revision

`server/manager-runtime-files.json` declares the local value-import graph loaded by `server/manager.ts`. The supervisor calculates its revision immediately before spawning the manager and passes that immutable identity to the child. The backend independently recalculates the same revision when the manifest or a declared file changes.

Keep the manifest aligned when adding or removing a runtime import. Type-only imports do not belong in it. `test/manager-runtime.test.ts` traverses local value imports and fails when a reachable file is missing; the manifest reader also rejects duplicates and paths outside the repository.

A revision mismatch changes the public state to `stale`; it does not restart or mutate the running manager.

## Public states

| State | Meaning |
| --- | --- |
| `checking` | The backend is reading or verifying the runtime identity. |
| `current` | The running and declared revisions match. |
| `stale` | Declared runtime files changed after this manager started. |
| `restarting` | A guarded restart was accepted and a replacement is expected. |
| `disconnected` | No manager connection is available. |
| `unknown` | The revision or replacement identity could not be verified. |

The backend emits these states through the `manager_status` SSE event. `canRestart` is true only for a stale manager that identifies itself as supervised.

## Guarded restart

1. The frontend calls `POST /api/manager/restart` through `src/api.ts`.
2. The backend requires a connected, stale, supervised manager and rejects duplicate requests.
3. The manager performs the authoritative check: no tracked request may remain, and each Pi process must report no streaming, compaction, queued message, or pending blocking UI.
4. After acknowledging the request, the manager closes its TCP server and Pi children. It requests `SIGTERM` on POSIX or closes Pi's input on Windows, then force-kills any remaining process or Windows process tree within bounded time before exiting with code `75`.
5. Only that exit code lets the supervisor calculate a fresh revision and start the replacement.
6. The monitor returns to `current` only after a different manager instance reconnects with the expected revision.

Idle Pi processes are closed by this restart. Their persisted sessions remain in history and can be reopened. On native Windows, application shutdown gives the manager a bounded grace period, then terminates its complete Pi process tree instead of relying on non-propagating POSIX signals. If the manager crashes or exits with another code, the supervisor stays alive without relaunching it; restart Pi Livecraft to recover.

## Changing this lifecycle

Changing manager behavior or its runtime imports is safe without restarting processes yourself: let the interface report the stale revision and let the user choose when to restart. Do not bypass the guarded endpoint or manually kill the manager or supervisor.

Changes to process ownership, supervision, exit-code handling, restart eligibility, or shutdown ordering alter the interruption boundary and require explicit approval. Run the focused lifecycle checks:

```bash
npm test -- test/manager-runtime.test.ts test/manager-runtime-monitor.test.ts test/manager.integration.test.ts
```
