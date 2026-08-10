"""Hermes CLI runtime for the Pi Coding UI backend."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BACKEND_PORT = 43_121
DEFAULT_STATE_DIR = Path.home() / ".hermes" / "state"
DEFAULT_STATE_FILE = DEFAULT_STATE_DIR / "hermes-pi-coding-ui-plugin.json"
HEALTH_PROBE_ATTEMPTS = 15
HEALTH_PROBE_INTERVAL_SECONDS = 1.0


def plugin_root() -> Path:
    override = os.environ.get("HERMES_PI_CODING_UI_PLUGIN_ROOT")
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parent.parent


def state_file_path() -> Path:
    override = os.environ.get("HERMES_PI_CODING_UI_STATE_FILE")
    if override:
        return Path(override).resolve()
    return DEFAULT_STATE_FILE


def backend_port() -> int:
    raw = os.environ.get("PI_LIVECRAFT_BACKEND_PORT", str(DEFAULT_BACKEND_PORT))
    try:
        port = int(raw)
    except ValueError as error:
        raise RuntimeError(
            f"PI_LIVECRAFT_BACKEND_PORT must be an integer, got {raw!r}."
        ) from error
    if port < 1 or port > 65_535:
        raise RuntimeError(f"PI_LIVECRAFT_BACKEND_PORT out of range: {port}.")
    return port


def health_url() -> str:
    return f"http://127.0.0.1:{backend_port()}/api/health"


def npm_command() -> str:
    command = shutil.which("npm.cmd") if sys.platform == "win32" else shutil.which("npm")
    if not command:
        raise RuntimeError("npm was not found on PATH. Install Node.js 24+ and retry.")
    return command


def read_state() -> dict | None:
    path = state_file_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def write_state(payload: dict) -> None:
    path = state_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def clear_state() -> None:
    path = state_file_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def probe_health(timeout_seconds: float = 2.0) -> tuple[bool, str]:
    request = urllib.request.Request(health_url(), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            if 200 <= response.status < 300:
                return True, f"healthy ({response.status})"
            return False, f"unexpected status {response.status}"
    except urllib.error.HTTPError as error:
        return False, f"HTTP {error.code}"
    except urllib.error.URLError as error:
        return False, str(error.reason)
    except TimeoutError:
        return False, "timed out"


def ensure_node_dependencies(root: Path) -> None:
    if (root / "node_modules").is_dir():
        return
    npm = npm_command()
    result = subprocess.run(
        [npm, "ci"],
        cwd=root,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "npm ci failed. Confirm Node.js 24+ is installed and retry."
        )


def wait_for_health() -> tuple[bool, str]:
    last_message = "not ready"
    for _ in range(HEALTH_PROBE_ATTEMPTS):
        healthy, message = probe_health()
        if healthy:
            return True, message
        last_message = message
        time.sleep(HEALTH_PROBE_INTERVAL_SECONDS)
    return False, last_message


def resolve_running_state() -> dict | None:
    state = read_state()
    if state is None:
        healthy, _ = probe_health()
        if healthy:
            return {"managed": False}
        return None

    pid = state.get("pid")
    if isinstance(pid, int) and pid_is_alive(pid):
        healthy, _ = probe_health()
        if healthy:
            return state
        return state

    healthy, _ = probe_health()
    if healthy:
        return {"managed": False, "stale_state": True, **state}

    clear_state()
    return None


def start(*, foreground: bool = False) -> int:
    root = plugin_root()
    ensure_node_dependencies(root)

    running = resolve_running_state()
    if running is not None:
        if running.get("managed") is False:
            print("Pi Coding UI backend is already running.")
            print(f"Health: {health_url()}")
            return 0
        pid = running.get("pid")
        print(f"Pi Coding UI backend is already running (pid {pid}).")
        print(f"Health: {health_url()}")
        log_path = running.get("log_path")
        if isinstance(log_path, str):
            print(f"Log: {log_path}")
        return 0

    npm = npm_command()
    use_foreground = foreground or sys.platform == "win32"

    if use_foreground:
        print("Starting Pi Coding UI backend in the foreground...")
        print(f"Health probe: {health_url()}")
        result = subprocess.run([npm, "run", "start"], cwd=root, check=False)
        return result.returncode

    log_path = state_file_path().with_suffix(".log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        [npm, "run", "start"],
        cwd=root,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log_handle.close()

    write_state(
        {
            "pid": process.pid,
            "log_path": str(log_path.resolve()),
            "plugin_root": str(root.resolve()),
            "started_at": time.time(),
        }
    )

    healthy, message = wait_for_health()
    if healthy:
        print("Pi Coding UI backend started.")
        print(f"PID: {process.pid}")
        print(f"Log: {log_path}")
        print(f"Health: {health_url()}")
        return 0

    if not pid_is_alive(process.pid):
        clear_state()
        print(
            "Pi Coding UI backend exited before becoming healthy.",
            file=sys.stderr,
        )
        print(f"See log: {log_path}", file=sys.stderr)
        return 1

    print("Pi Coding UI backend is starting but health check did not pass yet.")
    print(f"PID: {process.pid}")
    print(f"Log: {log_path}")
    print(f"Health probe: {health_url()} ({message})")
    return 0


def stop() -> int:
    state = read_state()
    if state is None:
        healthy, _ = probe_health()
        if healthy:
            print(
                "Pi Coding UI backend is running but was not started by "
                "hermes pi-coding-ui start.",
                file=sys.stderr,
            )
            return 1
        print("Pi Coding UI backend is not running.")
        return 0

    pid = state.get("pid")
    if not isinstance(pid, int):
        clear_state()
        print("Removed invalid runtime state file.")
        return 0

    if not pid_is_alive(pid):
        clear_state()
        print("Pi Coding UI backend is not running (stale state cleared).")
        return 0

    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(pid, signal.SIGTERM)
            for _ in range(HEALTH_PROBE_ATTEMPTS):
                if not pid_is_alive(pid):
                    break
                time.sleep(0.2)
            if pid_is_alive(pid):
                os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError as error:
        print(f"Could not stop backend (pid {pid}): {error}", file=sys.stderr)
        return 1

    clear_state()
    print("Pi Coding UI backend stopped.")
    return 0


def status() -> int:
    state = read_state()
    healthy, health_message = probe_health()

    if state is None:
        if healthy:
            print("Pi Coding UI backend is running (not managed by Hermes CLI).")
            print(f"Health: {health_url()} ({health_message})")
            return 0
        print("Pi Coding UI backend is not running.")
        print(f"Health: {health_url()} ({health_message})")
        return 1

    pid = state.get("pid")
    log_path = state.get("log_path")
    print("Pi Coding UI backend status:")
    if isinstance(pid, int):
        alive = pid_is_alive(pid)
        print(f"  PID: {pid} ({'running' if alive else 'not running'})")
    if isinstance(log_path, str):
        print(f"  Log: {log_path}")
    print(f"  Health: {health_url()} ({health_message})")

    if isinstance(pid, int) and not pid_is_alive(pid) and not healthy:
        clear_state()
        return 1
    return 0 if healthy else 1
