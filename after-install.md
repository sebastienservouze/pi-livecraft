## Pi Coding UI installed

### Prerequisites

- **Node.js 24+** and npm
- Configured **`pi`** command
- **Hermes dashboard** (`hermes dashboard`) on the same server

On Windows, Pi needs Bash (Git for Windows or `shellPath` in `~/.pi/agent/settings.json`).

### Start the backend on this server

```bash
hermes pi-coding-ui start
```

This installs Node dependencies on first run, then starts the manager and backend on `127.0.0.1`. The dashboard tab reaches that service through the Hermes plugin proxy at `/api/plugins/hermes-pi-coding-ui-plugin`, so your browser never talks to port `43121` directly.

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

Open the **Pi Coding UI** tab. No Backend URL override is needed when Hermes and the Pi backend run on the same host.

If the tab is missing after an update:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Restart `hermes dashboard` after upgrades so `dashboard/plugin_api.py` is loaded.

### Remote access

When you open Hermes from another machine, the Pi Coding UI still uses the **server's** workspaces, tools, Git state, and terminal. Open Folder and Open Terminal act on the server OS.

If the tab fails remotely, check `hermes pi-coding-ui status` on the server — not on your laptop.

### Troubleshooting

See the [README troubleshooting section](https://github.com/lyxtera/hermes-pi-coding-ui-plugin#troubleshooting).
