# hermes-pi-coding-ui-plugin

Hermes dashboard plugin that provides a browser UI for [Pi](https://pi.dev) coding agent sessions: workspaces, composer, conversation, Git, quotas, todos, and sidebar widgets.

The React UI loads inside `hermes dashboard`. A separate local Node backend and manager own Pi RPC processes on `127.0.0.1`.

## Requirements

- Node.js 24+
- npm
- Configured `pi` command
- [Hermes Agent](https://hermes-agent.nousresearch.com/) with `hermes dashboard`

Windows needs Bash for Pi (Git for Windows or `shellPath` in `~/.pi/agent/settings.json`).

## Install

```bash
hermes plugins install lyxtera/hermes-pi-coding-ui-plugin --enable
hermes pi-coding-ui start
hermes dashboard
```

Hermes clones the plugin into `~/.hermes/plugins/hermes-pi-coding-ui-plugin/` and loads the pre-built dashboard bundle from `dashboard/dist/`. Post-install steps are shown from `after-install.md`.

Check or stop the backend:

```bash
hermes pi-coding-ui status
hermes pi-coding-ui stop
```

On Windows, background start is unavailable — use `hermes pi-coding-ui start --foreground` or run `npm start` in the plugin directory.

## Run (development)

From a git clone:

```bash
git clone https://github.com/lyxtera/hermes-pi-coding-ui-plugin.git
cd hermes-pi-coding-ui-plugin
npm install
npm run dev
```

Starts the manager, backend (`http://127.0.0.1:43121` by default), and a watch build of `dashboard/dist/`.

In another terminal:

```bash
hermes dashboard
```

Open the **Pi Coding UI** tab (`/hermes-pi-coding-ui-plugin`).

Optional dev CLI alias (starts `npm run dev`):

```bash
npm link
pi-livecraft
```

After frontend edits, wait for the plugin rebuild, then refresh the dashboard tab or run:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

## Contributing

Before opening a PR that changes frontend source, rebuild and commit the dashboard bundle:

```bash
npm run build
git add dashboard/dist/
npm run verify:dist
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_LIVECRAFT_BACKEND_PORT` | `43121` | Backend HTTP + SSE port |
| `PI_LIVECRAFT_MANAGER_PORT` | `43120` | Manager JSON Lines port |
| `PI_LIVECRAFT_CORS_ORIGIN` | `http://127.0.0.1:9119` | Allowed Hermes dashboard origin |

Backend URL can also be changed in Settings → Backend connection (stored in browser `localStorage`).

Production backend only (no watch build):

```bash
npm start
```

## Architecture

```text
Hermes dashboard
  └─ dashboard/dist/index.js  (plugin tab)
        │ HTTP + SSE (CORS)
        ▼
server/backend.ts
        │ JSON Lines
        ▼
server/manager.ts ── Pi RPC ── pi --mode rpc
        ▲
server/manager-supervisor.ts
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MANAGER-LIFECYCLE.md](docs/MANAGER-LIFECYCLE.md).

## Documentation

Start at [docs/README.md](docs/README.md). Agent-oriented guides live under `docs/` and `src/features/*/README.md`.

## Development checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:dist
```

Pi RPC integration tests require a configured `pi` installation.

## Troubleshooting

- **`pi: command not found`** — install Pi globally; on Windows, `where.exe pi.cmd` must succeed.
- **Backend unavailable** — confirm ports `43120`/`43121` or env overrides; after a manager crash, restart with `hermes pi-coding-ui start` or `npm run dev`.
- **Plugin tab missing** — run `hermes plugins list`, confirm the plugin is enabled, then rescan: `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan`.
- **CORS errors** — backend must allow the Hermes dashboard origin; set `PI_LIVECRAFT_CORS_ORIGIN` if the dashboard port differs.

## License

MIT. See [LICENSE](LICENSE).
