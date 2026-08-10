"""Runtime tests for hermes pi-coding-ui CLI helpers."""

from __future__ import annotations

import os
import socket
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import MagicMock, patch

from hermes_plugin import runtime


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, _format, *_args) -> None:
        return


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class RuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.state_file = self.root / "state.json"
        self.port = _free_port()
        self.env = patch.dict(
            os.environ,
            {
                "HERMES_PI_CODING_UI_PLUGIN_ROOT": str(self.root),
                "HERMES_PI_CODING_UI_STATE_FILE": str(self.state_file),
                "PI_LIVECRAFT_BACKEND_PORT": str(self.port),
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def _start_health_server(self) -> HTTPServer:
        server = HTTPServer(("127.0.0.1", self.port), _HealthHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        return server

    def test_state_round_trip(self) -> None:
        runtime.write_state({"pid": 4242, "log_path": "/tmp/pi.log"})
        loaded = runtime.read_state()
        self.assertEqual(loaded, {"pid": 4242, "log_path": "/tmp/pi.log"})

    def test_start_reports_already_running_when_health_ok(self) -> None:
        self._start_health_server()
        (self.root / "node_modules").mkdir()
        code = runtime.start()
        self.assertEqual(code, 0)
        self.assertFalse(self.state_file.exists())

    def test_background_start_writes_state(self) -> None:
        (self.root / "node_modules").mkdir()
        process = MagicMock()
        process.pid = 43210

        with patch.object(runtime, "npm_command", return_value="/usr/bin/npm"), patch.object(
            runtime.subprocess,
            "Popen",
            return_value=process,
        ) as popen, patch.object(runtime, "wait_for_health", return_value=(True, "healthy")):
            code = runtime.start()

        self.assertEqual(code, 0)
        popen.assert_called_once()
        state = runtime.read_state()
        assert state is not None
        self.assertEqual(state["pid"], 43210)
        self.assertEqual(state["log_path"], str(self.state_file.with_suffix(".log")))
        self.assertEqual(state["plugin_root"], str(self.root))
        self.assertIsInstance(state["started_at"], float)

    def test_stop_clears_stale_state(self) -> None:
        runtime.write_state({"pid": 999_999, "log_path": str(self.root / "stale.log")})
        code = runtime.stop()
        self.assertEqual(code, 0)
        self.assertFalse(self.state_file.exists())


if __name__ == "__main__":
    unittest.main()
