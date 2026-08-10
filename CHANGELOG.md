# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Repackage Pi Livecraft as a Hermes web dashboard plugin instead of a standalone Vite SPA served by the backend.
- Scope plugin CSS under `.app-shell` and talk to the Node backend over a configurable cross-origin base URL with CORS.

### Removed

- Standalone `index.html`, `src/main.tsx`, and backend static file serving for the old SPA build.

## [1.2.0] - 2026-08-07

### Added

- Copy assistant code blocks to the clipboard with a single click.

### Changed

- Highlight tool call names with the app accent color for better readability.

### Fixed

- Assemble live assistant RPC deltas so streaming replies display as complete, coherent text.
- Show assistant output before blocking questions, instead of hiding it behind the prompt.

## [1.1.0] - 2026-08-05

### Added

- Run Pi Livecraft natively on Windows, including process launching, home-path resolution, terminal and directory completion.
- Manage sessions directly from the sidebar: rename them or close running Pi sessions without losing persisted history; the next nearby active session is selected automatically.
- Reclaim sidebar space by collapsing the sessions panel.
- Keep changes safer with CI checks (typecheck, lint, tests) against the latest Pi version.
- See GitHub project interest at a glance with a stars badge in the README.

### Changed

- Display Bash executable names like other tools, without repeating the `bash` prefix.
- Open long conversations much faster: Pi processes are reused instead of restarted; the first three sessions in each workspace keep their own process, and only a process idle for more than three minutes is reassigned afterward. Bursts can temporarily create additional processes.
- Browse conversations faster with cached Markdown rendering and lighter previews.
- Find recent work faster: sessions are sorted by latest activity, with active and ended states clearly distinguished in the sidebar.
- Understand session state at a glance: the sidebar now marks idle sessions that still have an attached Pi process; spacing, alignment and ended-session styling are also clearer.

### Fixed

- Avoid startup race failures: requests now wait briefly for the manager to connect.
- Open long conversations reliably: session histories up to 64 MiB no longer hit the default JSONL record limit.

## [1.0.0] - 2026-08-01

### Added

- Initial release.
