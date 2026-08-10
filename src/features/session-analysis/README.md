# Session analysis widget

Session analysis turns the selected Pi conversation into a compact dashboard. It is useful for finding expensive turns, noisy tools, repeated failures, or the point where context usage started to climb.

The dashboard is derived in the frontend. Opening it does not call another model; the explicit interpretation action runs a short isolated prompt and never alters the session.

## What it shows

- total, average, and median turn cost;
- assistant turn count, tool-call count, average tools per turn, and failure rate;
- current context usage plus cache-miss, cache-read, and output token totals;
- token usage and cost across assistant turns;
- cumulative tool usage ranked by input size, output size, or observed duration;
- individual tool calls ranked by input, output, observed duration, or failure;
- tool distribution with call and failure counts;
- the user requests that caused the most model cost;
- an optional concise interpretation prioritizing the costliest turns, their associated tools, cache/context efficiency, measured latency, and explicit failures.

The rail badge reports the number of explicit tool failures. Empty sections explain which activity is still needed instead of displaying misleading zeroes.

## Navigation

Turn charts, ranked tool calls, and costly request rows link back to the corresponding message or tool call in the conversation. Analysis is therefore a navigation aid, not just a report that lives beside the useful evidence.

## How to interpret the numbers

Pi's session totals remain authoritative. When a total cost cannot be matched to visible model requests, the widget reports the difference as unattributed rather than guessing where it belongs.

Historical messages provide token and cost data. Request and tool durations are only available when they were observed during the current plugin run, so reopened sessions can have complete costs but partial timing information.

Tool input and output rankings measure serialized input and raw output size, not provider tokens. Individual tool calls have no monetary cost attribution; monetary costs belong to requests. A tool failure is counted only when Pi reports `isError === true`. The interpretation reports duration signals only with their measurement coverage and treats partial data as such.

## Ownership and validation

`analyzeSession()` derives the report in linear time from the current session snapshot, Pi session stats, and live telemetry. `SessionAnalysisWidget` owns ranking choices, the optional isolated interpretation, and presentation. `App.tsx` supplies conversation navigation.

Focused coverage: `test/session-analysis.test.ts`.
