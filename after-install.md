## Pi Coding UI installed

### Prerequisites

- **Node.js 24+** and npm
- Configured **`pi`** command
- **Hermes dashboard** (`hermes dashboard`)

On Windows, Pi needs Bash (Git for Windows or `shellPath` in `~/.pi/agent/settings.json`).

### Start the backend

```bash
hermes pi-coding-ui start
```

This installs Node dependencies on first run, then starts the manager and backend on `127.0.0.1`.

**Windows:** background start is not supported — run in the foreground or use `npm start` in the plugin directory instead:

```bash
hermes pi-coding-ui start --foreground
```

Check status or stop:

```bash
hermes pi-coding-ui status
hermes pi-coding-ui stop
```

### Open the UI

```bash
hermes dashboard
```

Open the **Pi Coding UI** tab.

If the tab is missing after an update:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

### Troubleshooting

See the [README troubleshooting section](https://github.com/lyxtera/hermes-pi-coding-ui-plugin#troubleshooting).
